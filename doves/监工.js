/**
 * @file 监工
 * @description 扫描执行轨迹+综合判定+任务打终止标记
 * 
 * === 监工体系设计 ===
 * 旧机制已移除；
 * 新机制：
 *   1. 鸽子每轮LLM调用写入「轮次总结」轨迹节点（见 SubTask执行.js）
 *   2. 监工定期扫描活跃任务的执行轨迹
 *   3. 通过轨迹分析判定异常：工具循环、长期无进展、执行时间过长
 *   4. 异常时给任务打「终止标记」，鸽子检测到后优雅退出
 *   5. 异常状态自动修复保留（有error字段但状态running→修复为failed）
 * 
 * === 终止标记机制 ===
 *   任务文档新增字段: { 终止标记: { 原因: '...', 时间: ISODate, 监工ID: '...' } }
 *   鸽子执行循环中检测此字段，发现后抛出终止错误，优雅退出
 */

import { 任务状态, 是否子任务类型 } from './常量.js';
import { toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('监工', { 前缀: '[监工]', 级别: 'debug', 显示调用位置: true });

// 监工判定阈值（导出供系统提示词生成器等模块动态读取）
export const 判定阈值 = {
  无轮次总结超时: 30 * 60 * 1000,     // 30分钟无任何轮次总结 → 疑似卡死
  相同工具循环次数: 8,                  // 连续8次轮次用同一工具 → 疑似循环
  最大执行时长: 60 * 60 * 1000,         // 60分钟总执行时长 → 建议终止
  branch最大执行时长: 90 * 60 * 1000,   // Branch任务90分钟
  最大重试次数: 3,                      // 任务失败后最多放回队列重试次数
};

export class 监工 {
  constructor(配置 = {}) {
    this.心跳间隔 = 配置.心跳间隔 || 30000;
    this.扫描间隔 = 配置.扫描间隔 || 60000;
    this.定时器 = null;
    this.数据库定时器 = null;
    this.任务队列 = null;
    this.数据库 = null;
    this.用户数据库名 = null;
    this.智能体 = null;
    this.监工ID = `监工-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.统计 = {
      完成任务数: 0,
      失败任务数: 0,
      终止任务数: 0,
      打标任务数: 0,
    };
    // 扫描退避状态
    this._扫描连续失败次数 = 0;
    this._扫描退避中 = false;
    this._扫描退避定时器 = null;
    // 日志节流：避免高频扫描时大量重复日志
    this._lastScanLogTime = 0;
    this._scanLogThrottle = 5 * 60 * 1000; // 同类日志最少间隔5分钟
  }

  /**
   * 启动监工
   * @param {Object} 鸽子 - 被监控的鸽子实例
   */
  启动(鸽子) {
    logger.debug(`→ 启动: 鸽子=${鸽子?.名称 || '未知'}`);
    this.智能体 = 鸽子;
    
    // 数据库级轨迹扫描（定期扫描执行轨迹+异常判定）
    this.数据库定时器 = setInterval(() => {
      this.扫描活跃任务();
    }, this.扫描间隔);
    
    // 启动时延迟扫描
    setTimeout(() => this.扫描活跃任务(), 5000);
    logger.info(`← 启动完成: 心跳=${this.心跳间隔}ms, 扫描=${this.扫描间隔}ms`);
  }

  /**
   * 扫描数据库中活跃任务：异常状态修复 + 执行轨迹分析 + 终止标记
   */
  async 扫描活跃任务() {
    const _t0 = Date.now();
    if (!this.数据库 && !this.智能体?.branchTools?.database) return;
    if (this._扫描退避中) return;

    const _scanNow = Date.now();
    const _shouldLogScanStart = (_scanNow - (this._lastScanStartLogTime || 0)) > 3 * 60 * 1000;
    if (_shouldLogScanStart) {
      this._lastScanStartLogTime = _scanNow;
      logger.debug(`→ 扫描活跃任务`);
    }
    
    try {
      const db = this.数据库 || this.智能体.branchTools.database;
      const dbName = this.用户数据库名 || this.智能体.branchTools.用户数据库名;
      if (!db || !dbName) return;
      
      const 任务集合 = db.db(dbName).collection('任务');
      const 轨迹集合 = db.db(dbName).collection('执行轨迹');
      
      // 查找所有 running/waiting_children 状态的任务
      const 活跃任务 = await 任务集合.find({
        状态: { $in: ['执行中', '等待子任务'] }
      }).toArray();
      
      // 扫描成功，重置连续失败计数
      if (this._扫描连续失败次数 > 0) {
        logger.info(`扫描恢复（之前连续失败 ${this._扫描连续失败次数} 次）`);
        this._扫描连续失败次数 = 0;
      }
      
      // 汇总输出扫描信息（节流，避免每次扫描都输出）
      const now = Date.now();
      if (活跃任务.length > 0 && (now - this._lastScanLogTime) > this._scanLogThrottle) {
        this._lastScanLogTime = now;
        logger.debug(`扫描: ${活跃任务.length}个活跃任务`);
      }
      
      let 扫描有变动 = false;
      for (const 任务 of 活跃任务) {
        const 任务ID = 任务.任务ID || 任务._id?.toString();
        const 类型 = 任务.类型 || '';
        
        // 【异常状态检测】有error字段但状态是running → 自动修复
        if (任务.error || 任务.失败时间) {
          const 异常原因 = [];
          if (任务.error) 异常原因.push('有error字段');
          if (任务.失败时间) 异常原因.push('有失败时间');
          
            logger.error(`检测到异常状态任务 ${任务ID} (${异常原因.join(', ')})，自动修复为 failed`);
          
          await 任务集合.updateOne(
            { 任务ID },
            { $set: { 状态: 任务状态.FAILED, 终止原因: '监工检测到异常状态自动修复', 终止时间: new Date() } }
          );
          this.统计.终止任务数++;
          continue;
        }
        
        // 已有终止标记 → 跳过（鸽子应该会检测到并退出）
        if (任务.终止标记) continue;
        
        // 扫描执行轨迹，判定是否该打终止标记
        const 判定结果 = await this.分析执行轨迹(任务, 轨迹集合, 任务集合);
        
        if (判定结果.应终止) {
          扫描有变动 = true;
            logger.warn(`任务 ${任务ID} 判定异常: ${判定结果.原因}，打终止标记`);
          await this.打终止标记(任务ID, 任务集合, 判定结果.原因);
        }
      }
      
      // 扫描完成汇总（仅在有变动或首次扫描时输出）
      if (扫描有变动 || (活跃任务.length > 0 && (Date.now() - this._lastScanLogTime) >= this._scanLogThrottle)) {
        logger.debug(`← 扫描完成: ${活跃任务.length}个活跃任务 统计=${JSON.stringify(this.统计)} (${Date.now() - _t0}ms)`);
      }
    } catch (err) {
      this._处理扫描错误(err);
    }
  }

  /**
   * 分析执行轨迹，判定任务是否应该终止
   * @param {Object} 任务 - 任务文档
   * @param {Object} 轨迹集合 - MongoDB 执行轨迹集合
   * @param {Object} 任务集合 - MongoDB 任务集合
   * @returns {{ 应终止: boolean, 原因: string }}
   */
  async 分析执行轨迹(任务, 轨迹集合, 任务集合) {
    const _t0 = Date.now();
    const 任务ID = 任务.任务ID;
    const 类型 = 任务.类型;
    const now = Date.now();
    
    // 1. 执行时长检查（粗粒度安全网）
    const 创建时间戳 = 任务.创建时间戳 || (任务.创建时间 ? new Date(任务.创建时间).getTime() : 0);
    const 心跳时间戳 = 任务.心跳时间戳 || (任务.心跳时间 ? new Date(任务.心跳时间).getTime() : 0);
    const 最后活跃 = Math.max(创建时间戳, 心跳时间戳);
    
    // （运行时长日志已移至扫描汇总，不再逐任务输出）
    
    if (最后活跃 > 0) {
      const 运行时长 = now - 最后活跃;
      const 最大时长 = 类型 === 'branch' ? 判定阈值.branch最大执行时长 : 判定阈值.最大执行时长;
      if (运行时长 > 最大时长) {
        return { 应终止: true, 原因: `执行时长超过${Math.round(最大时长 / 60000)}分钟（${Math.round(运行时长 / 60000)}分钟）` };
      }
      // 仅在超过80%阈值时记录日志，避免每次扫描都输出
      if (运行时长 > 最大时长 * 0.8) {
        logger.debug(`任务 ${任务ID} 运行时长接近上限: ${Math.round(运行时长 / 60000)}/${Math.round(最大时长 / 60000)}分钟`);
      }
    }
    
    // 2. 等待用户交互的任务 → 不判定（用户响应慢不算异常）
    try {
      const db = this.数据库 || this.智能体?.branchTools?.database;
      const dbName = this.用户数据库名 || this.智能体?.branchTools?.用户数据库名;
      if (db && dbName) {
        const pendingAskCount = await db.db(dbName).collection('事件').countDocuments({
          事件类型: 'user_interaction',
          状态: '等待中'
        });
        if (pendingAskCount > 0) {
          return { 应终止: false, 原因: '' };
        }
      }
    } catch (err) {
      logger.warn(`检查用户交互状态失败: ${err.message}`);
    }
    
    // 3. 扫描执行轨迹中的轮次总结
    try {
      // 查找此任务的执行轨迹文档
      const 根任务ID = 任务.根任务ID || 任务ID;
      const 轨迹文档 = await 轨迹集合.findOne({ 根任务ID });
      
      if (!轨迹文档 || !轨迹文档.轨迹节点) {
        // 没有轨迹文档 → 可能在等排队，不算异常
        return { 应终止: false, 原因: '' };
      }
      
      // 筛选轮次总结节点
      const 轮次总结列表 = 轨迹文档.轨迹节点.filter(n => n.类型 === '轮次总结');
      
      // 3a. 有最终轮 → 任务应该快结束了，不打标
      const 有最终轮 = 轮次总结列表.some(n => n.输出?.是否最终轮 === true);
      if (有最终轮) {
        return { 应终止: false, 原因: '' };
      }
      
      // 3b. 无任何轮次总结 + 任务运行超过阈值 → 疑似卡死
      if (轮次总结列表.length === 0 && 最后活跃 > 0) {
        const 运行时长 = now - 最后活跃;
        if (运行时长 > 判定阈值.无轮次总结超时) {
          return { 应终止: true, 原因: `${Math.round(运行时长 / 60000)}分钟无轮次总结，疑似卡死` };
        }
        return { 应终止: false, 原因: '' };
      }
      
      // 3c. 最近轮次总结时间检查
      const 最后轮次 = 轮次总结列表[轮次总结列表.length - 1];
      if (最后轮次) {
        const 最后轮次时间 = 最后轮次.开始时间 ? new Date(最后轮次.开始时间).getTime() : 0;
        if (最后轮次时间 > 0) {
          const 距上次轮次 = now - 最后轮次时间;
          // Branch 任务可能子任务多，给更长的等待
          const 无进展阈值 = 类型 === 'branch' ? 判定阈值.无轮次总结超时 : 判定阈值.无轮次总结超时 / 2;
          if (距上次轮次 > 无进展阈值) {
            return { 应终止: true, 原因: `${Math.round(距上次轮次 / 60000)}分钟无新轮次总结` };
          }
        }
      }
      
      // 3d. 工具循环检测：最近N个轮次总结中，同一工具占比过高
      const 最近轮次 = 轮次总结列表.slice(-判定阈值.相同工具循环次数);
      if (最近轮次.length >= 判定阈值.相同工具循环次数) {
        const 工具出现计数 = {};
        for (const 轮次 of 最近轮次) {
          const 工具列表 = 轮次.输入?.工具列表 || [];
          for (const 工具名 of 工具列表) {
            工具出现计数[工具名] = (工具出现计数[工具名] || 0) + 1;
          }
        }
        // 某工具在每轮都出现 → 循环
        for (const [工具名, 计数] of Object.entries(工具出现计数)) {
          if (计数 >= 判定阈值.相同工具循环次数) {
            return { 应终止: true, 原因: `工具 ${工具名} 连续 ${计数} 轮调用，疑似循环` };
          }
        }
      }
      
    } catch (err) {
      logger.warn(`分析执行轨迹失败(${任务ID}): ${err.message} (${Date.now() - _t0}ms)`);
    }
    
    return { 应终止: false, 原因: '' };
  }

  /**
   * 给任务打终止标记（而非直接终止）
   * 鸽子执行循环中检测此字段，发现后优雅退出
   * @param {string} 任务ID - 任务ID
   * @param {Object} 任务集合 - MongoDB 任务集合
   * @param {string} 原因 - 终止原因
   */
  async 打终止标记(任务ID, 任务集合, 原因) {
    const _t0 = Date.now();
    logger.debug(`→ 打终止标记: 任务=${任务ID}, 原因=${原因}`);
    const 标记 = {
      原因,
      时间: new Date(),
      监工ID: this.监工ID,
    };
    
    await 任务集合.updateOne(
      { 任务ID },
      { $set: { 终止标记: 标记 } }
    );
    
    this.统计.打标任务数++;
    logger.info(`← 打终止标记: 任务=${任务ID}, 原因=${原因} (${Date.now() - _t0}ms)`);
    
    // 同时级联给子任务也打标记
    try {
      const 子任务列表 = await 任务集合.find({ 父任务ID: 任务ID, 状态: { $in: ['执行中', '等待子任务', '等待中', '已就绪'] } }).toArray();
      for (const 子任务 of 子任务列表) {
        await 任务集合.updateOne(
          { 任务ID: 子任务.任务ID },
          { $set: { 终止标记: { 原因: `父任务 ${任务ID} 被监工标记终止: ${原因}`, 时间: new Date(), 监工ID: this.监工ID } } }
        );
      }
    } catch (err) {
      logger.warn(`级联打标记失败: ${err.message}`);
    }
  }

  /**
   * 更新心跳时间
   * @param {string} 任务ID - 任务ID
   */
  async 更新心跳(任务ID) {
    if (this.任务队列) {
      await this.任务队列.更新心跳(任务ID, 'monitor');
    }
  }

  /**
   * 记录监控指标
   */
  记录指标(指标名, 值) {
    if (指标名 === '任务完成') {
      this.统计.完成任务数++;
    } else if (指标名 === '任务失败') {
      this.统计.失败任务数++;
    } else if (指标名 === '任务终止') {
      this.统计.终止任务数++;
    }
  }

  /**
   * 生成监工报告
   */
  生成报告() {
    return {
      运行时间: this.定时器 ? Date.now() : 0,
      完成任务数: this.统计.完成任务数,
      失败任务数: this.统计.失败任务数,
      终止任务数: this.统计.终止任务数,
      打标任务数: this.统计.打标任务数,
      心跳间隔: this.心跳间隔,
      扫描间隔: this.扫描间隔,
      监工ID: this.监工ID,
    };
  }

  /**
   * 停止监工
   */
  停止() {
    if (this.数据库定时器) {
      clearInterval(this.数据库定时器);
      this.数据库定时器 = null;
    }
    if (this._扫描退避定时器) {
      clearTimeout(this._扫描退避定时器);
      this._扫描退避定时器 = null;
    }
    logger.info(`← 监工已停止: 统计=${JSON.stringify(this.统计)}`);
  }

  /**
   * 处理扫描错误（退避逻辑）
   * @param {Error} err
   * @private
   */
  _处理扫描错误(err) {
    this._扫描连续失败次数++;
    const msg = err.message || '';
    const isTransient = msg.includes('timeout') || msg.includes('ECONNREFUSED') || msg.includes('timed out');

    if (isTransient && this._扫描连续失败次数 >= 3) {
      const 退避秒数 = Math.min(30 * Math.pow(2, this._扫描连续失败次数 - 3), 300);
      logger.warn(`扫描连续失败 ${this._扫描连续失败次数} 次，退避 ${退避秒数}秒`);
      this._扫描退避中 = true;
      if (this._扫描退避定时器) clearTimeout(this._扫描退避定时器);
      this._扫描退避定时器 = setTimeout(() => {
        this._扫描退避中 = false;
        this._扫描退避定时器 = null;
      }, 退避秒数 * 1000);
    } else if (this._扫描连续失败次数 <= 2 || !isTransient) {
      logger.error(`扫描活跃任务失败: ${err.message}`);
    }
  }
}

export default 监工;
