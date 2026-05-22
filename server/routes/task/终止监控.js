/**
 * @file server/routes/task/终止监控
 * @description 后台扫描器：检测监工打标记的任务，推送 CLI 等待用户确认终止/继续
 * 
 * === 设计原则 ===
 * 1. 监工判定异常 → 写入任务「终止标记」字段
 * 2. 本扫描器检测到「终止标记」→ 写入「终止确认: 等待用户」→ SSE 推送 CLI
 * 3. CLI 展示确认对话框 → 用户选择终止/继续
 * 4. 用户超时未响应 → 读取 terminationTimeout → 重新评估 → 代用户终止
 * 
 * === 终止确认状态机 ===
 * 无此字段 → 等待用户 → 已确认终止 / 用户继续 / 超时终止
 */

import { logger } from '../../core.js';
import { getAdminDb, getUserDb } from '../../db.js';

/** 默认超时配置 */
const 默认终止确认超时 = 30 * 60 * 1000;  // 30 分钟
/** 扫描间隔 */
const 扫描间隔 = 30000;  // 30 秒

/**
 * 终止监控类
 * 负责定期扫描数据库中有「终止标记」的任务，推送确认请求给 CLI
 */
export class 终止监控 {
  constructor(options = {}) {
    this.扫描间隔 = options.扫描间隔 || 扫描间隔;
    this._定时器 = null;
    this._运行中 = false;
    this.统计 = {
      扫描次数: 0,
      发现待确认: 0,
      超时自动终止: 0,
      用户确认终止: 0,
      用户选择继续: 0,
    };
  }

  /**
   * 启动后台扫描
   */
  启动() {
    if (this._运行中) return;
    this._运行中 = true;
    console.log('[终止监控] 启动后台扫描，间隔:', this.扫描间隔 / 1000, '秒');

    // 立即运行一次
    this._扫描().catch(err => {
      logger.error('[终止监控] 首次扫描失败:', err.message);
    });

    this._定时器 = setInterval(() => {
      this._扫描().catch(err => {
        logger.error('[终止监控] 扫描失败:', err.message);
      });
    }, this.扫描间隔);
  }

  /**
   * 停止后台扫描
   */
  停止() {
    this._运行中 = false;
    if (this._定时器) {
      clearInterval(this._定时器);
      this._定时器 = null;
    }
    console.log('[终止监控] 已停止');
  }

  /**
   * 主扫描逻辑
   * @private
   */
  async _扫描() {
    this.统计.扫描次数++;

    try {
      const db = getUserDb();
      const adminDb = getAdminDb();

      // DB 尚未就绪时跳过本次扫描（首次启动时路由加载早于 DB 连接）
      if (!db || !adminDb) {
        return;
      }

      // ========== 第一阶段：发现有「终止标记」但未推送确认的任务 ==========
      const 待确认任务 = await db.collection('任务').find({
        终止标记: { $exists: true },
        终止确认: { $exists: false },
        状态: { $in: ['执行中', '等待子任务'] },
      }).toArray();

      for (const 任务 of 待确认任务) {
        const 任务ID = 任务.任务ID;
        const userId = 任务.用户ID;

        // 读取用户配置的 terminationTimeout
        const 用户配置 = await this._获取用户终止配置(adminDb, userId);
        const 超时时间 = 用户配置.terminationTimeout;

        await db.collection('任务').updateOne(
          { 任务ID },
          {
            $set: {
              终止确认: {
                状态: '等待用户',
                原因: 任务.终止标记.原因,
                时间: new Date(),
                超时时间,  // 毫秒
                超时截止: 超时时间 === -1 ? null : new Date(Date.now() + 超时时间),
              }
            }
          }
        );

        console.log(`[终止监控] 任务 ${任务ID} 发现终止标记，已推送确认请求 (用户: ${userId}, 超时: ${超时时间 === -1 ? '永不' : (超时时间 / 60000) + '分钟'})`);
        this.统计.发现待确认++;
      }

      // ========== 第二阶段：检查等待超时的确认 ==========
      const 等待超时任务 = await db.collection('任务').find({
        终止确认: { $exists: true },
        '终止确认.状态': '等待用户',
        '终止确认.超时截止': { $ne: null, $lt: new Date() },
        状态: { $in: ['执行中', '等待子任务'] },
      }).toArray();

      for (const 任务 of 等待超时任务) {
        const 任务ID = 任务.任务ID;
        const userId = 任务.用户ID;

        // 用户已超时未响应 → 重新评估执行轨迹
        const 仍无进展 = await this._检查轨迹进展(db, 任务);

        if (仍无进展) {
          // 代用户决定：确认终止
          await db.collection('任务').updateOne(
            { 任务ID },
            {
              $set: {
                '终止确认.状态': '超时终止',
                '终止确认.确认时间': new Date(),
                '终止确认.超时原因': '用户超时未响应且轨迹仍无进展',
              }
            }
          );
          console.log(`[终止监控] 任务 ${任务ID} 用户超时未响应，轨迹无进展，代用户终止`);
          this.统计.超时自动终止++;
        } else {
          // 有进展 → 清除确认请求（监工需重新评估）
          await db.collection('任务').updateOne(
            { 任务ID },
            {
              $unset: { 终止确认: '', 终止标记: '' }
            }
          );
          console.log(`[终止监控] 任务 ${任务ID} 用户超时但轨迹有进展，清除终止标记`);
        }
      }

      if (待确认任务.length > 0 || 等待超时任务.length > 0) {
        console.log(`[终止监控] 扫描完成: 发现待确认=${待确认任务.length}, 超时处理=${等待超时任务.length}`);
      }

    } catch (err) {
      // Fail Fast: 数据库连接错误向上抛，调用方有退避逻辑
      throw err;
    }
  }

  /**
   * 获取用户终止超时配置
   * @param {Object} adminDb - 管理库
   * @param {string} userId - 用户ID
   * @returns {{ terminationTimeout: number }} 毫秒，-1 表示永不超时
   * @private
   */
  async _获取用户终止配置(adminDb, userId) {
    try {
      const 用户配置 = await adminDb.collection('API密钥').findOne(
        { 用户ID: userId },
        { projection: { terminationTimeout: 1 } }
      );
      return {
        terminationTimeout: 用户配置?.terminationTimeout ?? 默认终止确认超时,
      };
    } catch (err) {
      logger.warn('[终止监控] 读取用户配置失败:', err.message);
      return { terminationTimeout: 默认终止确认超时 };
    }
  }

  /**
   * 检查执行轨迹是否有进展
   * 最近一次轮次总结时间在阈值内 → 有进展
   * @param {Object} db - 用户数据库
   * @param {Object} 任务 - 任务文档
   * @returns {boolean} 是否仍无进展
   * @private
   */
  async _检查轨迹进展(db, 任务) {
    try {
      const 根任务ID = 任务.根任务ID || 任务.任务ID;
      const 轨迹文档 = await db.collection('执行轨迹').findOne({ 根任务ID });

      if (!轨迹文档 || !轨迹文档.轨迹节点) return true;  // 无轨迹 = 无进展

      const 轮次总结列表 = 轨迹文档.轨迹节点.filter(n => n.类型 === '轮次总结');
      if (轮次总结列表.length === 0) return true;  // 无轮次总结 = 无进展

      // 检查最近一次轮次总结的时间
      const 最后轮次 = 轮次总结列表[轮次总结列表.length - 1];
      const 最后轮次时间 = 最后轮次.开始时间 ? new Date(最后轮次.开始时间).getTime() : 0;

      // 如果终止确认发出后仍有新的轮次总结（时间在确认时间之后）→ 有进展
      const 确认时间 = 任务.终止确认?.时间 ? new Date(任务.终止确认.时间).getTime() : 0;
      if (最后轮次时间 > 确认时间 && 确认时间 > 0) {
        return false;  // 有新轮次总结 → 有进展
      }

      // 最后轮次在确认时间之前，且距今太久 → 无进展
      const 距上次轮次 = Date.now() - 最后轮次时间;
      if (距上次轮次 > 10 * 60 * 1000) {  // 超过10分钟无新轮次
        return true;
      }

      return false;
    } catch (err) {
      logger.warn('[终止监控] 检查轨迹进展失败:', err.message);
      return true;  // 检查失败，保守按无进展处理
    }
  }

  /**
   * 处理用户终止确认响应（供 API 层调用）
   * @param {string} taskId - 任务ID
   * @param {string} action - '终止' 或 '继续'
   * @param {string} userId - 用户ID
   * @returns {Object} 处理结果
   */
  async 处理用户响应(taskId, action, userId) {
    const db = getUserDb();

    const 任务 = await db.collection('任务').findOne({ 任务ID: taskId });
    if (!任务) {
      return { success: false, error: '任务不存在' };
    }

    // 权限检查
    if (任务.用户ID !== userId) {
      return { success: false, error: '无权操作此任务' };
    }

    if (!任务.终止确认) {
      return { success: false, error: '该任务没有待确认的终止请求' };
    }

    if (任务.终止确认.状态 !== '等待用户') {
      return { success: false, error: `终止确认状态为 "${任务.终止确认.状态}"，无法操作` };
    }

    if (action === '终止') {
      await db.collection('任务').updateOne(
        { 任务ID: taskId },
        {
          $set: {
            '终止确认.状态': '已确认终止',
            '终止确认.确认时间': new Date(),
            '终止确认.确认方式': '用户手动确认',
          }
        }
      );
      console.log(`[终止监控] 任务 ${taskId} 用户确认终止`);
      this.统计.用户确认终止++;
      return { success: true, action: '终止', message: '已确认终止，鸽子将优雅退出' };
    }

    if (action === '继续') {
      await db.collection('任务').updateOne(
        { 任务ID: taskId },
        {
          $unset: { 终止标记: '', 终止确认: '' }
        }
      );
      console.log(`[终止监控] 任务 ${taskId} 用户选择继续`);
      this.统计.用户选择继续++;
      return { success: true, action: '继续', message: '已取消终止，任务继续执行' };
    }

    return { success: false, error: `无效操作: ${action}，只支持 "终止" 或 "继续"` };
  }

  /**
   * 生成监控报告
   * @returns {Object}
   */
  生成报告() {
    return {
      运行中: this._运行中,
      ...this.统计,
      扫描间隔: this.扫描间隔,
    };
  }
}

/** 单例 */
let _实例 = null;

export function 获取终止监控实例(options = {}) {
  if (!_实例) {
    _实例 = new 终止监控(options);
  }
  return _实例;
}

export default { 终止监控, 获取终止监控实例 };
