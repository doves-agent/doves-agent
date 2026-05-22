/**
 * 独立 ObjectId 实现
 * 
 * 替代 `import { ObjectId } from 'mongodb'`，消除 doves/cli 对 mongodb 驱动的依赖。
 * 遵循"禁止直连数据库"架构原则：doves 和 cli 不应依赖 mongodb 包。
 * 
 * 兼容 MongoDB ObjectId 格式：24位十六进制字符串
 * 格式：4字节时间戳(8hex) + 5字节随机(10hex) + 3字节计数器(6hex)
 * 
 * 注意：此模块仅用于生成唯一标识符，不创建任何数据库连接。
 * 如果需要操作数据库，必须通过 DovesProxy 走服务端代理。
 */

import { randomBytes } from 'crypto';

// 进程级计数器，防止同进程同毫秒碰撞
let _counter = Math.floor(Math.random() * 0xFFFFFF);

// 进程级随机数（5字节），同一进程内所有 ObjectId 共享
const _machineRandom = randomBytes(5).toString('hex');

/**
 * 生成与 MongoDB ObjectId 兼容的24位十六进制字符串
 * @returns {string} 24位十六进制字符串
 */
export function generateObjectId() {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const cnt = (_counter++ & 0xFFFFFF).toString(16).padStart(6, '0');
  return timestamp + _machineRandom + cnt;
}

/**
 * ObjectId 类
 * 兼容 MongoDB ObjectId 的接口：new ObjectId() / objectId.toString()
 * 
 * 用法与 mongodb 包完全一致：
 *   import { ObjectId } from '../common/对象标识.js';
 *   const id = new ObjectId();        // 自动生成
 *   const id = new ObjectId('已知ID'); // 从字符串构造
 *   id.toString()                      // → '6601a2b3c4d5e6f7a8b9c0d1'
 */
export class ObjectId {
  /**
   * @param {string|null} id - 已有的ID字符串，为空则自动生成
   */
  constructor(id) {
    if (id) {
      this._id = String(id);
    } else {
      this._id = generateObjectId();
    }
  }

  /**
   * 转为字符串
   * @returns {string}
   */
  toString() {
    return this._id;
  }

  /**
   * JSON 序列化
   */
  toJSON() {
    return this._id;
  }

  /**
   * 比较相等
   */
  equals(other) {
    if (!other) return false;
    return this._id === (other._id || other.toString());
  }

  /**
   * 获取时间戳部分（前4字节）
   */
  getTimestamp() {
    const timestamp = parseInt(this._id.substring(0, 8), 16);
    return new Date(timestamp * 1000);
  }
}

export default ObjectId;
