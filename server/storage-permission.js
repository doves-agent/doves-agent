/**
 * 瑶池目录权限服务
 * 
 * 【KISS原则文档的一部分】
 * 
 * === 功能说明 ===
 * 管理瑶池存储的目录权限，支持：
 * - 目录级别权限控制
 * - 文件级别权限控制
 * - 权限继承（可覆盖）
 * - 权限分配和撤销
 * 
 * === 权限模型 ===
 * 权限值采用位掩码设计（累进制）：
 * - VIEW (1):   查看目录列表、文件名
 * - DOWNLOAD (2): 下载文件、读取内容
 * - EDIT (4):   上传、修改、重命名
 * - DELETE (8): 删除文件和目录
 * - ADMIN (16): 管理权限、分配权限给其他用户
 * 
 * 累进规则：高权限自动包含低权限能力
 * 例如：权限值=6 (EDIT) 自动拥有 VIEW+DOWNLOAD
 * 
 * === 权限继承 ===
 * 子目录/文件默认继承父目录权限
 * 可以在任意层级覆盖权限（更高或更低）
 * 
 * === API ===
 * - 检查权限(userId, 路径, 需要权限) → {allowed, effectivePermission}
 * - 获取有效权限(userId, 路径) → 权限值
 * - 分配权限(目录ID, 用户ID, 权限值, 选项) → 权限记录
 * - 撤销权限(权限ID) → 成功/失败
 * - 列出目录权限(目录ID) → 权限列表
 * - 列出用户可访问目录(userId) → 目录列表
 * - 创建目录(拥有者ID, 路径, 选项) → 目录记录
 * - 查找目录按路径(路径) → 目录记录
 */

import { getAdminDb } from './db.js';
import { ObjectId } from 'mongodb';
import { logger } from './core.js';
import { getTimestamp, createTimestampFields } from '../common/时间工具.js';

// ==================== 权限常量 ====================

/**
 * 权限值定义（位掩码）
 */
export const PERMISSIONS = {
  VIEW: 1,      // 查看：列出目录、查看文件名
  DOWNLOAD: 2,  // 下载：读取文件内容
  EDIT: 4,      // 修改：上传、修改、重命名
  DELETE: 8,    // 删除：删除文件和目录
  ADMIN: 16     // 管理：分配权限给其他用户
};

/**
 * 全部权限
 */
export const FULL_PERMISSIONS = 31; // 1+2+4+8+16

/**
 * 将权限值转换为可读字符串
 * @param {number} permission - 权限值
 * @returns {string} 权限描述字符串
 */
export function permissionToString(permission) {
  const parts = [];
  if (permission & PERMISSIONS.VIEW) parts.push('查看');
  if (permission & PERMISSIONS.DOWNLOAD) parts.push('下载');
  if (permission & PERMISSIONS.EDIT) parts.push('编辑');
  if (permission & PERMISSIONS.DELETE) parts.push('删除');
  if (permission & PERMISSIONS.ADMIN) parts.push('管理');
  if (parts.length === 0) return '无权限';
  if (permission === FULL_PERMISSIONS) return '完全控制';
  return parts.join('+');
}

/**
 * 检查是否有某个权限
 * @param {number} userPermission - 用户权限值
 * @param {number} requiredPermission - 需要的权限值
 * @returns {boolean}
 */
export function hasPermission(userPermission, requiredPermission) {
  return (userPermission & requiredPermission) === requiredPermission;
}

/**
 * 检查权限是否满足（累进规则）
 * 高权限自动包含低权限
 * @param {number} userPermission - 用户权限值
 * @param {number} requiredPermission - 需要的权限值
 * @returns {boolean}
 */
export function checkPermissionLevel(userPermission, requiredPermission) {
  // 累进规则：权限值 >= 需要值即满足
  return userPermission >= requiredPermission;
}

// ==================== 目录管理 ====================

/**
 * 生成目录ID
 */
function generateDirectoryId() {
  return new ObjectId().toString();
}

/**
 * 创建瑶池目录记录
 * @param {string} 拥有者ID - 用户ID
 * @param {string} 路径 - 目录路径（相对于挂载点）
 * @param {object} 选项 - 可选配置
 * @returns {Promise<object>} 目录记录
 */
export async function 创建目录(拥有者ID, 路径, 选项 = {}) {
  const db = getAdminDb();
  if (!db) {
    throw new Error('数据库未连接');
  }
  
  // 检查路径是否已存在
  const existing = await db.collection('瑶池目录').findOne({ 路径 });
  if (existing) {
    return { 成功: false, 错误: '目录路径已存在', 目录: existing };
  }
  
  const ts = createTimestampFields();
  const 目录ID = 选项.目录ID || generateDirectoryId();
  
  const 目录 = {
    目录ID,
    名称: 选项.名称 || 路径.split('/').pop() || '未命名目录',
    路径,
    拥有者ID,
    类型: 选项.类型 || 'personal', // personal | shared | system
    配额: 选项.配额 || {
      容量: 10737418240, // 默认 10GB
      已用: 0
    },
    描述: 选项.描述 || '',
    标签: 选项.标签 || [],
    创建时间: ts.localTime,
    更新时间: ts.localTime,
    创建时间戳: ts.timestamp,
    更新时间戳: ts.timestamp,
    状态: '活跃'
  };
  
  await db.collection('瑶池目录').insertOne(目录);
  
  // 自动为拥有者创建全部权限记录
  await db.collection('目录权限').insertOne({
    目录ID,
    用户ID: 拥有者ID,
    权限值: FULL_PERMISSIONS,
    范围: 'directory',
    相对路径: null, // 根目录
    授权者ID: 拥有者ID,
    授权时间: ts.localTime,
    过期时间: null,
    状态: '活跃'
  });
  
  logger.info(`创建瑶池目录: ${目录ID} (${路径}) 拥有者: ${拥有者ID}`);
  
  return { 成功: true, 目录 };
}

/**
 * 根据路径查找目录
 * @param {string} 路径 - 目录路径
 * @returns {Promise<object|null>}
 */
export async function 查找目录按路径(路径) {
  const db = getAdminDb();
  if (!db) return null;
  
  return await db.collection('瑶池目录').findOne({ 
    路径, 
    状态: '活跃' 
  });
}

/**
 * 根据目录ID查找目录
 * @param {string} 目录ID - 目录ID
 * @returns {Promise<object|null>}
 */
export async function 查找目录按ID(目录ID) {
  const db = getAdminDb();
  if (!db) return null;
  
  return await db.collection('瑶池目录').findOne({ 
    目录ID, 
    状态: '活跃' 
  });
}

/**
 * 查找路径所属的目录（支持子路径）
 * @param {string} 完整路径 - 文件或目录的完整路径
 * @returns {Promise<object|null>}
 */
export async function 查找所属目录(完整路径) {
  const db = getAdminDb();
  if (!db) return null;
  
  // 规范化路径
  let 路径 = 完整路径.replace(/\/+/g, '/');
  if (!路径.startsWith('/')) {
    路径 = '/' + 路径;
  }
  
  // 查找最匹配的目录（路径最长匹配）
  const 目录列表 = await db.collection('瑶池目录')
    .find({ 状态: '活跃' })
    .sort({ 路径: -1 }) // 按路径长度降序
    .toArray();
  
  for (const 目录 of 目录列表) {
    if (路径.startsWith(目录.路径 + '/') || 路径 === 目录.路径) {
      return 目录;
    }
  }
  
  return null;
}

/**
 * 列出用户拥有的目录
 * @param {string} userId - 用户ID
 * @param {object} 过滤条件 - 可选过滤
 * @returns {Promise<array>}
 */
export async function 列出用户目录(userId, 过滤条件 = {}) {
  const db = getAdminDb();
  if (!db) return [];
  
  const 查询条件 = { 拥有者ID: userId, 状态: '活跃' };
  if (过滤条件?.类型) {
    查询条件.类型 = 过滤条件.类型;
  }
  
  return await db.collection('瑶池目录')
    .find(查询条件)
    .sort({ 创建时间戳: -1 })
    .toArray();
}

// ==================== 权限检查 ====================

/**
 * 获取用户对路径的有效权限
 * @param {string} userId - 用户ID
 * @param {string} 路径 - 相对路径或绝对路径
 * @returns {Promise<{有效权限: number, 目录: object|null}>}
 */
export async function 获取有效权限(userId, 路径) {
  const db = getAdminDb();
  if (!db) {
    return { 有效权限: 0, 目录: null };
  }
  
  // 1. 查找所属目录
  const 目录 = await 查找所属目录(路径);
  if (!目录) {
    return { 有效权限: 0, 目录: null };
  }
  
  // 2. 拥有者拥有全部权限
  if (目录.拥有者ID === userId) {
    return { 有效权限: FULL_PERMISSIONS, 目录 };
  }
  
  // 3. 计算相对路径
  let 相对路径 = 路径.slice(目录.路径.length) || '/';
  相对路径 = 相对路径.replace(/^\/+/, '/').replace(/\/+$/, '');
  
  // 4. 查找权限记录
  let 有效权限 = 0;
  
  // 4.1 如果是文件，先查找文件级别权限
  if (相对路径 && !相对路径.endsWith('/')) {
    const 文件权限 = await db.collection('目录权限').findOne({
      目录ID: 目录.目录ID,
      用户ID: userId,
      范围: 'file',
      相对路径,
      状态: '活跃'
    });
    if (文件权限) {
      有效权限 = 文件权限.权限值;
      return { 有效权限, 目录, 权限来源: 'file' };
    }
  }
  
  // 4.2 向上查找目录权限（继承）
  // 分解路径，从深到浅查找
  const 路径段 = 相对路径.split('/').filter(Boolean);
  
  for (let i = 路径段.length; i >= 0; i--) {
    const 当前相对路径 = i === 0 ? null : '/' + 路径段.slice(0, i).join('/');
    
    const 目录权限 = await db.collection('目录权限').findOne({
      目录ID: 目录.目录ID,
      用户ID: userId,
      范围: 'directory',
      相对路径: 当前相对路径,
      状态: '活跃'
    });
    
    if (目录权限) {
      有效权限 = 目录权限.权限值;
      return { 有效权限, 目录, 权限来源: 'directory', 权限路径: 当前相对路径 };
    }
  }
  
  return { 有效权限: 0, 目录 };
}

/**
 * 检查用户对路径的权限
 * @param {string} userId - 用户ID
 * @param {string} 路径 - 相对路径或绝对路径
 * @param {number} 需要权限 - 需要的权限值
 * @returns {Promise<{允许: boolean, 有效权限: number, 目录: object|null}>}
 */
export async function 检查权限(userId, 路径, 需要权限) {
  const { 有效权限, 目录 } = await 获取有效权限(userId, 路径);
  
  return {
    允许: 有效权限 >= 需要权限,
    有效权限,
    目录
  };
}

// ==================== 权限管理 ====================

/**
 * 分配权限
 * @param {string} 目录ID - 目录ID
 * @param {string} 用户ID - 被授权用户ID
 * @param {number} 权限值 - 权限值
 * @param {object} 选项 - 可选配置
 * @returns {Promise<object>}
 */
export async function 分配权限(目录ID, 用户ID, 权限值, 选项 = {}) {
  const db = getAdminDb();
  if (!db) {
    throw new Error('数据库未连接');
  }
  
  // 检查目录是否存在
  const 目录 = await 查找目录按ID(目录ID);
  if (!目录) {
    return { 成功: false, 错误: '目录不存在' };
  }
  
  // 检查授权者是否有管理权限
  const 授权者ID = 选项.授权者ID;
  if (授权者ID && 授权者ID !== 目录.拥有者ID) {
    const { 有效权限 } = await 获取有效权限(授权者ID, 目录.路径);
    if (!hasPermission(有效权限, PERMISSIONS.ADMIN)) {
      return { 成功: false, 错误: '无管理权限' };
    }
  }
  
  const ts = createTimestampFields();
  
  // 构建权限记录
  const 权限记录 = {
    目录ID,
    用户ID,
    权限值,
    范围: 选项.范围 || 'directory', // directory | file
    相对路径: 选项.相对路径 || null,
    授权者ID: 授权者ID || 目录.拥有者ID,
    授权时间: ts.localTime,
    过期时间: 选项.过期时间 || null,
    状态: '活跃'
  };
  
  // 使用 upsert 避免重复
  const 查询条件 = {
    目录ID,
    用户ID,
    相对路径: 权限记录.相对路径
  };
  
  const 结果 = await db.collection('目录权限').findOneAndUpdate(
    查询条件,
    { $set: 权限记录 },
    { 
      upsert: true,
      returnDocument: 'after'
    }
  );
  
  logger.info(`分配权限: 目录=${目录ID} 用户=${用户ID} 权限=${权限值}`);
  
  return { 成功: true, 权限记录: 结果.value };
}

/**
 * 撤销权限
 * @param {string} 权限ID - 权限记录ID（_id）
 * @param {string} 操作者ID - 操作者ID
 * @returns {Promise<object>}
 */
export async function 撤销权限(权限ID, 操作者ID) {
  const db = getAdminDb();
  if (!db) {
    throw new Error('数据库未连接');
  }
  
  const 权限记录 = await db.collection('目录权限').findOne({ _id: 权限ID });
  if (!权限记录) {
    return { 成功: false, 错误: '权限记录不存在' };
  }
  
  // 检查目录
  const 目录 = await 查找目录按ID(权限记录.目录ID);
  if (!目录) {
    return { 成功: false, 错误: '目录不存在' };
  }
  
  // 检查操作权限
  if (操作者ID && 操作者ID !== 目录.拥有者ID) {
    const { 有效权限 } = await 获取有效权限(操作者ID, 目录.路径);
    if (!hasPermission(有效权限, PERMISSIONS.ADMIN)) {
      return { 成功: false, 错误: '无管理权限' };
    }
  }
  
  // 标记为撤销状态
  await db.collection('目录权限').updateOne(
    { _id: 权限ID },
    { $set: { 状态: '已撤销' } }
  );
  
  logger.info(`撤销权限: ${权限ID} 操作者=${操作者ID}`);
  
  return { 成功: true };
}

/**
 * 列出目录的权限记录
 * @param {string} 目录ID - 目录ID
 * @returns {Promise<array>}
 */
export async function 列出目录权限(目录ID) {
  const db = getAdminDb();
  if (!db) return [];
  
  return await db.collection('目录权限')
    .find({ 目录ID, 状态: '活跃' })
    .sort({ 授权时间: -1 })
    .toArray();
}

/**
 * 列出用户可访问的目录
 * @param {string} userId - 用户ID
 * @returns {Promise<array>}
 */
export async function 列出用户可访问目录(userId) {
  const db = getAdminDb();
  if (!db) return [];
  
  // 1. 获取用户拥有的目录
  const 拥有的目录 = await db.collection('瑶池目录')
    .find({ 拥有者ID: userId, 状态: '活跃' })
    .toArray();
  
  // 2. 获取用户有权限的目录
  const 权限记录列表 = await db.collection('目录权限')
    .find({ 用户ID: userId, 状态: '活跃' })
    .toArray();
  
  const 目录ID集合 = new Set(权限记录列表.map(r => r.目录ID));
  
  // 3. 获取这些目录的详情
  const 有权限的目录 = [];
  for (const 目录ID of 目录ID集合) {
    const 目录 = await 查找目录按ID(目录ID);
    if (目录 && 目录.拥有者ID !== userId) {
      // 获取用户对该目录的有效权限
      const { 有效权限 } = await 获取有效权限(userId, 目录.路径);
      有权限的目录.push({
        ...目录,
        我的权限: 有效权限
      });
    }
  }
  
  // 4. 合并结果
  return [
    ...拥有的目录.map(d => ({ ...d, 我的权限: FULL_PERMISSIONS })),
    ...有权限的目录
  ];
}

// ==================== 导出 ====================

export default {
  // 权限常量
  PERMISSIONS,
  FULL_PERMISSIONS,
  hasPermission,
  checkPermissionLevel,
  
  // 目录管理
  创建目录,
  查找目录按路径,
  查找目录按ID,
  查找所属目录,
  列出用户目录,
  
  // 权限检查
  获取有效权限,
  检查权限,
  
  // 权限管理
  分配权限,
  撤销权限,
  列出目录权限,
  列出用户可访问目录
};
