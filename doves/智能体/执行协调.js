import { createTimestampFields } from '@dove/common/时间工具.js';
import { 任务状态 } from '../常量.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('执行协调', { 前缀: '[智能体]', 级别: 'debug', 显示调用位置: true });
export function mixin执行协调(instance) {
  
  // 任务失败自愈 - KISS 模式下简化为空操作，不创建替代子任务
  // 自愈历史记录保留，方便诊断
  instance.自愈重规划 = async function(失败任务, 错误) {
    logger.info(`自愈重规划(KISS模式): 跳过，不创建替代子任务`);
    
    // 仅记录自愈历史（诊断用），不再创建替代子任务
    try {
      const 失败任务ID = 失败任务.任务ID || 失败任务.id;
      if (失败任务ID && this.任务队列) {
        const collection = this.任务队列._获取集合();
        if (collection) {
          const ts = createTimestampFields();
          await collection.updateOne(
            { $or: [{ 任务ID: 失败任务ID }, { id: 失败任务ID }, { _id: 失败任务ID }] },
            {
              $push: {
                自愈历史: {
                  $each: [{
                    时间: ts.localTime,
                    时间戳: ts.timestamp,
                    鸽子ID: this.ID,
                    失败原因: 错误?.message || String(错误),
                    替代子任务数: 0,
                    替代子任务IDs: [],
                    重试次数: 失败任务.重试次数 || 0,
                    模式: 'KISS-跳过自愈'
                  }],
                  $slice: -50
                }
              }
            }
          );
        }
      }
    } catch (记录错误) {
      logger.warn(`自愈历史记录失败（不影响主流程）: ${记录错误.message}`);
    }
    
    return [];  // KISS 模式：不创建替代子任务
  }
  
  //
  // 分析失败并生成替代方案 - KISS 模式下简化
  // 不再创建替代子任务，只做可重试判断
  //
  instance.分析失败并生成替代方案 = function(失败任务, 错误) {
    const 重试次数 = 失败任务.重试次数 || 失败任务.params?.重试次数 || 0;
    
    // 安全护栏：限制最大重试次数
    if (重试次数 >= 3) {
      return { 可恢复: false, 原因: `已达到最大重试次数 (${重试次数})`, 替代子任务: [] };
    }
    
    return {
      可恢复: true,
      原因: '任务失败，标记为可重试',
      替代子任务: []  // KISS 模式：不创建替代子任务
    };
  }
  
  //
  // 处理任务失败
  instance.处理失败 = async function(任务, 错误) {
    const _t0 = Date.now();
    logger.info(`→ 处理失败: 任务=${任务.任务ID}, 类型=${任务.类型 || '未知'}, 错误=${(错误?.message || '').substring(0, 80)}`);
    
    // routing 类型任务是顶层路由任务，不应自愈重规划（它只是路由记录，无技能可重试）
    const 任务类型 = 任务.类型 || '';
    const 是路由任务 = 任务类型 === 'routing';
    
    // 优先尝试重试：如果是可重试错误（限流、网络、超时），放回队列而不是直接标FAILED
    // routing 任务不重试，直接走失败流程
    if (!是路由任务) {
      try {
        const 重试成功 = await this.任务队列.重试任务(任务.任务ID, 错误);
        if (重试成功) {
          logger.info(`任务已放回队列等待重试 (${Date.now() - _t0}ms)`);
          // 放回队列成功，清理状态即可
          this.当前任务 = null;
          await this.切换状态('在线');
          return;
        }
        // 重试不成功（不可重试错误或重试次数用完），继续走正常失败流程
      } catch (重试错误) {
        logger.error(`重试逻辑异常: ${重试错误.message}`);
        // 继续走正常失败流程
      }
    }
    
    // 正常失败流程：更新任务状态为 failed
    try {
      const failTs = createTimestampFields();
      await this.任务队列.更新状态(任务.任务ID, 任务状态.FAILED, {
        error: 错误.message,
        失败时间: failTs.localTime,
        失败时间戳: failTs.timestamp
      });
      } catch (状态更新错误) {
      logger.error(`更新失败状态时出错: ${状态更新错误.message}`);
    }
    
    // 尝试自愈重规划（KISS 模式：仅记录诊断信息，不创建替代子任务）
    if (!是路由任务) {
      try {
        await this.自愈重规划(任务, 错误);
      } catch (重规划错误) {
        logger.warn(`自愈重规划异常: ${重规划错误.message}`);
      }
    }
    
    // 清理当前状态（确保一定会执行）
    this.当前任务 = null;
    await this.切换状态('在线');
    logger.info(`← 处理失败完成 (${Date.now() - _t0}ms)`);
  }

  //
  // 根据能力匹配判断是否应该抢取任务
  instance.应该抢取任务 = function(任务) {
    const 匹配结果 = this.能力管理器.匹配任务能力(任务);
    
    if (!匹配结果.匹配成功) {
      logger.debug(`跳过抢取: 任务=${任务.任务ID}, 缺失能力=[${匹配结果.缺失的能力.join(', ')}]`);
      return false;
    }
    
    // 计算适配得分
    const 得分 = this.计算任务适配得分(任务);
    
    const 阈值 = this.抢任务阈值 ?? 0.5;
    
    return 得分 > 阈值;
  }

  //
  // 计算任务适配得分
  instance.计算任务适配得分 = function(任务) {
    // 简单能力匹配：检查任务所需能力是否在本鸽子能力列表中
    const 所需能力 = 任务.所需能力 || 任务.requiredCapabilities || [];
    if (所需能力.length === 0) return 1.0;
    const 已有能力 = new Set(this.能力列表);
    const 匹配数 = 所需能力.filter(c => 已有能力.includes(c)).length;
    return 匹配数 / 所需能力.length;
  }


  //
  // 保存当前执行状态（用于崩溃恢复）
  // 鸽子状态存储在管理库的鸽子身份集合中
  instance.保存执行状态 = async function(任务) {
    logger.debug(`保存执行状态: 任务=${任务?.任务ID || '无'}`);
    
    // 更新鸽子身份状态（管理库）
    await this.更新鸽子身份状态(this.状态, 任务?.id || null);
    
    // 保存任务检查点
    if (任务?.id) {
      const checkTs = createTimestampFields();
      await this.任务队列.保存检查点(任务.任务ID, {
        鸽子ID: this.ID,
        任务状态: this.状态,
        时间: checkTs.localTime,
        时间戳: checkTs.timestamp
      });
    }
  }

  //
  // 恢复执行状态
  instance.恢复执行状态 = async function(任务ID) {
    // 从鸽子身份获取状态（通过服务端）
    let 身份记录 = null;
    if (this.DovesProxy) {
      const result = await this.DovesProxy.adminDbOperation('鸽子身份', 'findOne', {
        query: { 鸽子ID: this.ID }
      });
      身份记录 = result.success ? result.data : null;
    }
    
    if (!身份记录) {
      return null;
    }
    
    // 恢复检查点
    const 检查点 = await this.任务队列.恢复检查点(任务ID);
    
    if (检查点) {
      this.状态 = 检查点.任务状态 || '在线';
    } else if (身份记录.状态) {
      this.状态 = 身份记录.状态;
    }
    
    return {
      当前任务: 身份记录.当前任务ID ? await this.任务队列.获取任务(身份记录.当前任务ID) : null,
      状态: this.状态
    };
  }

  //
  // 更新鸽子身份状态（通过服务端）
  instance.更新鸽子身份状态 = async function(状态, 任务ID = null) {
    if (!this.DovesProxy) return;
    
    const ts = createTimestampFields();
    
    await this.DovesProxy.updateDoveIdentity(this.ID, {
      状态: 状态,
      当前任务ID: 任务ID,
      最后见到时间: ts.localTime
    });
  }

  //
  // 切换鸽子状态（统一入口）
  // 同时更新内存状态和同步到数据库，确保状态一致性
  // 
  instance.切换状态 = async function(新状态, 任务ID = null) {
    const 旧状态 = this.状态;
    this.状态 = 新状态;
    logger.debug(`状态切换: ${旧状态} → ${新状态}${任务ID ? `, 任务=${任务ID}` : ''}`);
    
    // 同步到数据库（瞬态失败静默，避免日志海啸；心跳会补偿）
    try {
      await this.更新鸽子身份状态(新状态, 任务ID);
    } catch (错误) {
      logger.warn(`状态同步失败: ${错误.message}`);
    }
  }

  //
  // 更新心跳（写入 MongoDB）
  instance.更新心跳 = async function() {
    if (this.当前任务) {
            logger.debug(`更新任务 ${this.当前任务.任务ID} 心跳`);
      
      // 更新任务队列心跳
      await this.任务队列.更新心跳(this.当前任务.任务ID, this.ID);
      
      // 更新监工心跳
      await this.监工.更新心跳(this.当前任务.任务ID);
    }
    
    // 同步鸽子身份状态（心跳时顺便更新）
    await this.更新鸽子身份状态(this.状态, this.当前任务?.id || null);
  }

  //
  // 获取智能体状态报告
  instance.获取状态报告 = function() {
    return {
      ID: this.ID,
      名称: this.名称,
      状态: this.状态,
      当前任务: this.当前任务?.id || null,
      能力列表: this.能力列表,
      运行中: this.运行中
    };
  }
}
