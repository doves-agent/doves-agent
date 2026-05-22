/**
 * @file 轨迹写入器
 * @description 记录任务执行全链路轨迹（树形结构），存入 MongoDB
 * 
 * === 设计原则 ===
 * - fire-and-forget：写入不阻塞执行主流程
 * - 输入/输出自动截断到500字符，防止文档过大
 * - 上下文自动传递：Branch → SubTask → ToolCall
 * - 一个任务一条文档：通过 $push 追加节点，通过 父轨迹ID 构建树
 * 
 * === 存储结构 ===
 * 每个根任务一条文档：
 * {
 *   根任务ID: 'task_xxx',
 *   用户ID: 'u_xxx',
 *   轨迹节点: [
 *     { 轨迹ID, 类型, 名称, 父轨迹ID, 状态, ... },
 *     ...
 *   ],
 *   创建时间, 创建时间戳
 * }
 * 
 * === 轨迹事件类型 ===
 * routing      - 路由决策
 * planning     - 任务规划
 * 三性验证     - 审核结果
 * 用户审批     - 审批结果
 * subtask      - 子任务执行
 * tool_call    - 工具调用
 * skill_trigger - 技能触发
 * llm_call     - LLM调用
 * 综合理解     - 综合理解
 * 递归拆分     - 递归拆分
 * 失败处理     - 失败处理
 * event_trigger - 事件触发
 */

import { toLocalISOString, getTimestamp } from '@dove/common/时间工具.js';
import { ObjectId } from '@dove/common/对象标识.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('轨迹写入器', { 前缀: '[轨迹写入器]', 级别: 'debug', 显示调用位置: true });

/** 截断阈值 */
const MAX_TEXT_LENGTH = 500;

/**
 * 截断对象中的字符串值
 * @param {*} obj - 要截断的对象
 * @param {number} maxLen - 最大长度
 * @returns {*} 截断后的对象
 */
function 截断(obj, maxLen = MAX_TEXT_LENGTH) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return obj.length > maxLen ? obj.substring(0, maxLen) + '...' : obj;
  }
  if (obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 10).map(v => 截断(v, maxLen));
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = 截断(v, maxLen);
  }
  return result;
}

/**
 * 生成轨迹ID
 */
function 生成轨迹ID() {
  return new ObjectId().toString();
}

/**
 * 轨迹写入器类
 * 
 * 存储模式：一个根任务一条文档，所有轨迹节点通过 $push 追加到 轨迹节点 数组
 */
export class 轨迹写入器 {
  /**
   * @param {Object} 数据库代理 - DovesProxy 实例（禁止直连数据库，必须通过鸽子代理访问）
   * @param {string} 用户数据库名
   * @param {Function|null} 广播回调
   */
  constructor(数据库代理, 用户数据库名, 广播回调 = null) {
    this.数据库代理 = 数据库代理;
    this.用户数据库名 = 用户数据库名 || 'doves_user_data';
    this.广播回调 = 广播回调;
    
    // 当前上下文
    this._根任务ID = null;
    this._任务ID = null;
    this._父轨迹ID = null;
    this._序号 = 0;
    this._用户ID = null;
    
    // 集合引用
    this._collection = null;
    
    // 开始时间戳缓存（用于原子计算耗时，避免查完改再更新）
    this._开始时间缓存 = new Map();
  }

  /**
   * 获取集合引用（延迟初始化）
   */
  _获取集合() {
    if (!this._collection && this.数据库代理) {
      try {
        const db = this.数据库代理.db(this.用户数据库名);
        this._collection = db.collection('执行轨迹');
      } catch (e) {
        logger.warn(`[轨迹写入器] 获取集合失败: ${e.message}`);
      }
    }
    return this._collection;
  }

  /**
   * 设置当前上下文（每次任务执行开始时调用）
   * @param {string} 根任务ID - 根任务ID
   * @param {string} 任务ID - 当前任务ID
   * @param {string|null} 父轨迹ID - 父轨迹节点ID
   * @param {string} 用户ID - 用户ID
   */
  设置上下文(根任务ID, 任务ID, 父轨迹ID = null, 用户ID = null) {
    this._根任务ID = 根任务ID;
    this._任务ID = 任务ID;
    this._父轨迹ID = 父轨迹ID;
    this._用户ID = 用户ID;
    this._序号 = 0;
  }

  /**
   * 创建子上下文（用于subtask，子轨迹的父ID指向subtask节点）
   * @param {string} 父轨迹ID - 父轨迹节点ID
   * @param {string} 任务ID - 子任务ID
   * @returns {轨迹写入器} 新的轨迹写入器实例（共享数据库连接和广播回调）
   */
  创建子上下文(父轨迹ID, 任务ID) {
    const child = new 轨迹写入器(this.数据库代理, this.用户数据库名, this.广播回调);
    child._根任务ID = this._根任务ID;
    child._任务ID = 任务ID;
    child._父轨迹ID = 父轨迹ID;
    child._序号 = 0;
    child._用户ID = this._用户ID;
    child._collection = this._collection;  // 共享集合引用
    return child;
  }

  /**
   * 开始一个轨迹节点（返回轨迹ID，后续用complete/fail关闭）
   * @param {string} 类型 - 事件类型
   * @param {string} 名称 - 可读名称
   * @param {Object} 输入 - 输入参数
   * @param {Object} 元数据 - 额外上下文（可包含 决策原因 字段）
   * @returns {string} 轨迹ID
   */
  async 记录开始(类型, 名称, 输入 = null, 元数据 = null) {
    const 轨迹ID = 生成轨迹ID();
    const now = toLocalISOString();
    
    // 从元数据中提取决策原因（有则写入，无则忽略）
    const 决策原因 = 元数据?.决策原因 || null;
    const 清洁元数据 = 元数据 ? { ...元数据 } : null;
    if (清洁元数据 && 清洁元数据.决策原因) delete 清洁元数据.决策原因;
    
    const node = {
      轨迹ID,
      任务ID: this._任务ID,
      父轨迹ID: this._父轨迹ID,
      
      类型,
      名称,
      状态: '执行中',
      序号: ++this._序号,
      
      开始时间: now,
      结束时间: null,
      耗时: null,
      
      输入: 截断(输入),
      输出: null,
      错误: null,
      
      决策原因: 决策原因,
      元数据: 清洁元数据 || null
    };

    await this._pushNode(node, true);  // 等待写入完成，避免后续记录完成时 positional operator 找不到节点
    
    // 缓存开始时间戳，供 记录完成/记录失败 计算耗时
    this._开始时间缓存.set(轨迹ID, Date.now());
    
    // 实时推送（fire-and-forget）
    this._广播轨迹更新(node);
    
    return 轨迹ID;
  }

  /**
   * 完成一个轨迹节点
   * @param {string} 轨迹ID - 轨迹节点ID
   * @param {Object} 输出 - 输出结果
   * @param {string} 状态 - 完成状态（completed/skipped）
   * @param {Object} 选项 - 可选参数 { token消耗: { 输入, 输出 } }
   */
  async 记录完成(轨迹ID, 输出 = null, 状态 = '已完成', 选项 = null) {
    const coll = this._获取集合();
    if (!coll) return;

    const now = toLocalISOString();
    const 开始时间戳 = this._开始时间缓存.get(轨迹ID);
    const 耗时 = 开始时间戳 ? (Date.now() - 开始时间戳) : null;
    this._开始时间缓存.delete(轨迹ID);
    
    // token消耗可选，有则写入
    const token消耗 = 选项?.token消耗 || null;
    
    // 提取推理过程（如果输出包含），截取前2000字符避免数据库膨胀
    const 推理过程 = 输出?.推理过程 ? 输出.推理过程.substring(0, 2000) : null;
    
    // 使用 arrayFilters 替代 positional operator $
    // positional operator $ 要求查询条件精确匹配数组元素，若节点未写入则报错
    // arrayFilters 通过 $[elem] 语法定位数组元素，更健壮且不依赖查询条件的数组匹配
    const 更新字段 = {
      '轨迹节点.$[elem].状态': 状态,
      '轨迹节点.$[elem].结束时间': now,
      '轨迹节点.$[elem].耗时': 耗时,
      '轨迹节点.$[elem].输出': 截断(输出),
    };
    if (token消耗) {
      更新字段['轨迹节点.$[elem].token消耗'] = token消耗;
    }
    if (推理过程) {
      更新字段['轨迹节点.$[elem].推理过程'] = 推理过程;
    }
    
    // 一次 updateOne 原子完成：状态 + 结束时间 + 耗时 + 输出 + token消耗 + 推理过程
    // 使用 arrayFilters 定位目标节点，避免 positional operator 的匹配失败问题
    coll.updateOne(
      { 根任务ID: this._根任务ID },
      { $set: 更新字段 },
      { arrayFilters: [{ 'elem.轨迹ID': 轨迹ID }] }
    ).then(() => {
      // 写入成功
    }).catch(e => {
      logger.warn(`[轨迹写入器] 记录完成失败: ${e.message}`);
    });
    
    // 实时推送（fire-and-forget）
    this._广播轨迹更新({ 轨迹ID, 状态, 结束时间: now, 耗时, 输出: 截断(输出), token消耗, 推理过程 });
  }

  /**
   * 标记失败
   * @param {string} 轨迹ID - 轨迹节点ID
   * @param {string} 错误 - 错误信息
   */
  async 记录失败(轨迹ID, 错误) {
    const coll = this._获取集合();
    if (!coll) return;

    const now = toLocalISOString();
    const 开始时间戳 = this._开始时间缓存.get(轨迹ID);
    const 耗时 = 开始时间戳 ? (Date.now() - 开始时间戳) : null;
    this._开始时间缓存.delete(轨迹ID);

    // 使用 arrayFilters 替代 positional operator $，避免节点未写入时的匹配失败
    coll.updateOne(
      { 根任务ID: this._根任务ID },
      {
        $set: {
          '轨迹节点.$[elem].状态': '失败',
          '轨迹节点.$[elem].结束时间': now,
          '轨迹节点.$[elem].耗时': 耗时,
          '轨迹节点.$[elem].错误': typeof 错误 === 'string' ? 错误 : 错误?.message || String(错误),
        }
      },
      { arrayFilters: [{ 'elem.轨迹ID': 轨迹ID }] }
    ).then(() => {
      // 写入成功
    }).catch(e => {
      logger.warn(`[轨迹写入器] 记录失败失败: ${e.message}`);
    });
    
    // 实时推送（fire-and-forget）
    this._广播轨迹更新({ 轨迹ID, 状态: '失败', 结束时间: now, 耗时, 错误: typeof 错误 === 'string' ? 错误 : 错误?.message || String(错误) });
  }

  /**
   * 一步完成（无需中间态的瞬时事件，如三性验证、用户审批）
   * @param {string} 类型 - 事件类型
   * @param {string} 名称 - 可读名称
   * @param {Object} 输入 - 输入参数
   * @param {Object} 输出 - 输出结果
   * @param {string} 状态 - 完成状态
   * @param {Object} 元数据 - 额外上下文
   * @returns {string} 轨迹ID
   */
  async 记录瞬间(类型, 名称, 输入 = null, 输出 = null, 状态 = '已完成', 元数据 = null) {
    const 轨迹ID = 生成轨迹ID();
    const now = toLocalISOString();
    
    const node = {
      轨迹ID,
      任务ID: this._任务ID,
      父轨迹ID: this._父轨迹ID,
      
      类型,
      名称,
      状态,
      序号: ++this._序号,
      
      开始时间: now,
      结束时间: now,
      耗时: 0,
      
      输入: 截断(输入),
      输出: 截断(输出),
      错误: null,
      
      元数据: 元数据 || null
    };

    this._pushNode(node);
    return 轨迹ID;
  }

  /**
   * $push 追加节点到根文档的 轨迹节点 数组（fire-and-forget）
   * 写入策略：先尝试纯$push（文档大概率已存在），失败再upsert创建文档
   * @param {Object} node - 轨迹节点
   */
  _pushNode(node, waitForWrite = false) {
    const coll = this._获取集合();
    if (!coll || !this._根任务ID) return waitForWrite ? Promise.resolve() : undefined;
    
    // 不再静默吞掉错误：waitForWrite=true 时让调用者感知写入失败
    // 这样 记录开始 返回后，节点一定是已写入 DB 的，后续 记录完成 才能可靠更新
    if (waitForWrite) {
      return this._尝试写入节点(coll, node).then(() => {
        // 写入成功
      }).catch(e => {
        logger.warn(`[轨迹写入器] 写入节点失败: ${e.message}`);
      });
    }
    // fire-and-forget：记录瞬间等非关键路径，写入失败不阻塞主流程
    this._尝试写入节点(coll, node).then(() => {
      // 写入成功
    }).catch(e => {
      logger.debug(`[轨迹写入器] 写入节点(fire-and-forget)失败: ${e.message}`);
    });
  }

  /**
   * 写入轨迹节点（先$push，不存在则upsert创建文档）
   * @private
   */
  async _尝试写入节点(coll, node) {
    // 先尝试纯$push（文档大概率已存在，避免upsert引发的E11000）
    const pushResult = await coll.updateOne(
      { 根任务ID: this._根任务ID },
      { $push: { 轨迹节点: node } }
    );
    
    // matchedCount > 0 表示文档存在且$push成功
    if (pushResult.matchedCount > 0) return;
    
    // 文档不存在，需要创建（upsert）
    // 并发场景：多鸽子同时首次写入同一 根任务ID 时，upsert 会竞争产生 E11000
    // 这不是降级逻辑，是 MongoDB upsert 并发竞争的必要正确性处理
    try {
      await coll.updateOne(
        { 根任务ID: this._根任务ID },
        {
          $push: { 轨迹节点: node },
          $setOnInsert: {
            用户ID: this._用户ID || null,
            创建时间: toLocalISOString(),
            创建时间戳: getTimestamp()
          }
        },
        { upsert: true }
      );
    } catch (e) {
      const isDupKey = e.code === 11000 || e.codeName === 'DuplicateKey';
      if (isDupKey) {
        // 另一个鸽子已创建文档，直接 $push
        await coll.updateOne(
          { 根任务ID: this._根任务ID },
          { $push: { 轨迹节点: node } }
        );
      } else {
        throw e;
      }
    }
  }

  // ==================== 上下文访问器 ====================

  get 根任务ID() { return this._根任务ID; }
  get 当前任务ID() { return this._任务ID; }
  get 当前父轨迹ID() { return this._父轨迹ID; }

  // ==================== 广播推送 ====================

  /**
   * 实时广播轨迹更新（fire-and-forget，不阻塞主流程）
   * @param {Object} 轨迹节点数据 - 轨迹节点数据（全部或部分）
   * @private
   */
  _广播轨迹更新(轨迹节点数据) {
    if (!this.广播回调 || !this._根任务ID) return;
    try {
      this.广播回调({
        type: 'trace_update',
        根任务ID: this._根任务ID,
        node: 轨迹节点数据
      });
    } catch (e) {
      logger.debug(`广播轨迹更新失败: ${e.message}`);
    }
  }
}

export default 轨迹写入器;
