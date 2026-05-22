/**
 * @file tools/对话工具
 * @description conversation 和 turn 的操作方法
 */

import { toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { ObjectId } from '@dove/common/对象标识.js';

/**
 * 对话工具类
 */
export class ConversationTools {
  constructor(配置 = {}) {
    this.database = 配置.database;
    this.用户数据库名 = 配置.用户数据库名 || 'doves_user_data';
  }

  /**
   * 创建对话
   * @param {string} userId - 用户ID
   * @param {Object} 选项 - 可选参数
   * @returns {Object} 创建的对话
   */
  async createConversation(userId, 选项 = {}) {
    if (!this.database) {
      throw new Error('数据库未连接');
    }

    const db = this.database.db(this.用户数据库名);
    const conversations = db.collection('对话');

    const convId = new ObjectId().toString();
    const conversation = {
      _id: convId,
      对话ID: convId,
      用户ID: userId,
      标题: 选项.title || '新对话',
      对话轮次: [],
      当前轮次ID: 0,
      状态: '活跃',
          
      创建时间: toLocalISOString(),
      创建时间戳: getTimestamp(),
      更新时间: toLocalISOString(),
      更新时间戳: getTimestamp()
    };

    await conversations.insertOne(conversation);
    return conversation;
  }

  /**
   * 获取对话
   * @param {string} conversationId - 对话ID
   * @returns {Object} 对话对象
   */
  async getConversation(conversationId) {
    if (!this.database) {
      throw new Error('数据库未连接');
    }

    const db = this.database.db(this.用户数据库名);
    const conversations = db.collection('对话');

    // 修复: 使用 '对话ID' 字段查询，服务端创建对话时用的是 '对话ID' 字段
    return await conversations.findOne({ 对话ID: conversationId });
  }

  /**
   * 添加 Turn
   * @param {string} conversationId - 对话ID
   * @param {Object} turn - Turn 数据
   * @returns {Object} 更新结果
   */
  async addTurn(conversationId, turn) {
    if (!this.database) {
      throw new Error('数据库未连接');
    }

    const db = this.database.db(this.用户数据库名);
    const conversations = db.collection('对话');

    const now = toLocalISOString();
    const nowTs = getTimestamp();

    // 修复: 使用 '对话ID' 字段查询，服务端创建对话时用的是 '对话ID' 字段
    const result = await conversations.updateOne(
      { 对话ID: conversationId },
      {
        $push: { 对话轮次: turn },
        $set: {
          当前轮次ID: turn.turnId,
          更新时间: now,
          更新时间戳: nowTs
        }
      }
    );

    return { 成功: result.modifiedCount > 0, modifiedCount: result.modifiedCount };
  }

  /**
   * 更新 Turn 的 Branch Summary
   * @param {string} conversationId - 对话ID
   * @param {number} turnId - Turn ID
   * @param {string} summary - Branch 总结
   * @returns {Object} 更新结果
   */
  async updateTurnSummary(conversationId, turnId, summary) {
    if (!this.database) {
      throw new Error('数据库未连接');
    }

    const db = this.database.db(this.用户数据库名);
    const conversations = db.collection('对话');

    // 修复: 使用 '对话ID' 字段查询，服务端创建对话时用的是 '对话ID' 字段
    // 修复: 使用 '轮次ID'(中文) 字段匹配，路由执行器创建轮次时用的是 '轮次ID' 键名
    const result = await conversations.updateOne(
      { 对话ID: conversationId, '对话轮次.轮次ID': turnId },
      {
        $set: {
          '对话轮次.$.分支摘要': summary,
          更新时间: toLocalISOString(),
          更新时间戳: getTimestamp()
        }
      }
    );

    return { 成功: result.modifiedCount > 0 };
  }

  /**
   * 获取历史 Turns
   * @param {string} conversationId - 对话ID
   * @param {number} limit - 限制数量
   * @returns {Array} Turns 列表
   */
  async getHistory(conversationId, limit = 10) {
    const conversation = await this.getConversation(conversationId);
    if (!conversation || !conversation.对话轮次) {
      return [];
    }

    return conversation.对话轮次.slice(-limit);
  }

  /**
   * 获取用户的所有对话
   * @param {string} userId - 用户ID
   * @param {Object} 选项 - 分页选项
   * @returns {Array} 对话列表
   */
  async listConversations(userId, 选项 = {}) {
    if (!this.database) {
      throw new Error('数据库未连接');
    }

    const db = this.database.db(this.用户数据库名);
    const conversations = db.collection('对话');

    const limit = 选项.limit || 20;
    const skip = 选项.skip || 0;

    return await conversations
      .find({ 用户ID: userId, 状态: { $ne: '已删除' } })
      .sort({ 更新时间戳: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
  }

  /**
   * 删除对话（软删除）
   * @param {string} conversationId - 对话ID
   * @returns {Object} 删除结果
   */
  async deleteConversation(conversationId) {
    if (!this.database) {
      throw new Error('数据库未连接');
    }

    const db = this.database.db(this.用户数据库名);
    const conversations = db.collection('对话');

    // 修复: 使用 '对话ID' 字段查询，服务端创建对话时用的是 '对话ID' 字段
    const result = await conversations.updateOne(
      { 对话ID: conversationId },
      {
        $set: {
          状态: '已删除',
          删除时间: toLocalISOString(),
          删除时间戳: getTimestamp()
        }
      }
    );

    return { 成功: result.modifiedCount > 0 };
  }

  /**
   * 更新对话标题
   * @param {string} conversationId - 对话ID
   * @param {string} title - 新标题
   * @returns {Object} 更新结果
   */
  async updateTitle(conversationId, title) {
    if (!this.database) {
      throw new Error('数据库未连接');
    }

    const db = this.database.db(this.用户数据库名);
    const conversations = db.collection('对话');

    // 修复: 使用 '对话ID' 字段查询，服务端创建对话时用的是 '对话ID' 字段
    const result = await conversations.updateOne(
      { 对话ID: conversationId },
      {
        $set: {
          标题: title,
          更新时间: toLocalISOString(),
          更新时间戳: getTimestamp()
        }
      }
    );

    return { 成功: result.modifiedCount > 0 };
  }
}

// 导出
export default ConversationTools;
