/**
 * 统一错误码定义 - 全局唯一错误码源
 *
 * 所有 API 返回统一格式：
 *   { success: false, errorCode: 'AUTH_002', error: '认证令牌已过期，请重新登录', requestId }
 *
 * 使用方式：
 *   import { 错误码, 创建错误响应 } from '@dove/common/错误码.js';
 *   res.status(401).json(创建错误响应(错误码.AUTH_002, req.requestId));
 *
 * 或者直接创建带错误码的 Error：
 *   import { 创建业务错误 } from '@dove/common/错误码.js';
 *   throw 创建业务错误(错误码.AUTH_002);
 */

// ==================== 错误码枚举 ====================

export const 错误码 = {
  // === 认证相关 (AUTH_xxx) ===
  AUTH_001: { code: 'AUTH_001', status: 401, message: '未提供认证令牌' },
  AUTH_002: { code: 'AUTH_002', status: 401, message: '认证令牌已过期，请重新登录' },
  AUTH_003: { code: 'AUTH_003', status: 401, message: '认证令牌无效' },
  AUTH_004: { code: 'AUTH_004', status: 401, message: '用户名或密码错误' },
  AUTH_005: { code: 'AUTH_005', status: 401, message: 'API Key 无效或已过期' },
  AUTH_006: { code: 'AUTH_006', status: 423, message: '账号已被锁定，请稍后再试' },
  AUTH_007: { code: 'AUTH_007', status: 400, message: '用户名已存在' },
  AUTH_008: { code: 'AUTH_008', status: 400, message: '用户名和密码必填' },
  AUTH_009: { code: 'AUTH_009', status: 400, message: '密码强度不足' },
  AUTH_010: { code: 'AUTH_010', status: 404, message: '用户不存在' },
  AUTH_011: { code: 'AUTH_011', status: 403, message: '权限不足' },

  // === 任务相关 (TASK_xxx) ===
  TASK_001: { code: 'TASK_001', status: 404, message: '任务不存在' },
  TASK_002: { code: 'TASK_002', status: 409, message: '任务已被领取' },
  TASK_003: { code: 'TASK_003', status: 429, message: '已达并发上限，请稍后再试' },
  TASK_004: { code: 'TASK_004', status: 400, message: '任务参数无效' },

  // === 鸽子相关 (DOVE_xxx) ===
  DOVE_001: { code: 'DOVE_001', status: 404, message: '鸽子不存在' },
  DOVE_002: { code: 'DOVE_002', status: 400, message: '鸽子离线' },

  // === 配额相关 (QUOTA_xxx) ===
  QUOTA_001: { code: 'QUOTA_001', status: 429, message: '配额不足' },
  QUOTA_002: { code: 'QUOTA_002', status: 429, message: '配额已满' },

  // === 通用错误 (GEN_xxx) ===
  GEN_001: { code: 'GEN_001', status: 400, message: '请求参数无效' },
  GEN_002: { code: 'GEN_002', status: 404, message: '资源不存在' },
  GEN_003: { code: 'GEN_003', status: 500, message: '服务器内部错误' },
  GEN_004: { code: 'GEN_004', status: 400, message: '操作不被允许' },
};

// ==================== 辅助函数 ====================

/**
 * 创建统一错误响应体
 * @param {Object} 错误定义 - 错误码对象 (如 错误码.AUTH_002)
 * @param {string} [requestId] - 请求ID
 * @param {string} [detail] - 附加详情（覆盖默认 message）
 * @returns {Object} { success, errorCode, error, requestId }
 */
export function 创建错误响应(错误定义, requestId, detail) {
  return {
    success: false,
    errorCode: 错误定义.code,
    error: detail || 错误定义.message,
    ...(requestId && { requestId }),
  };
}

/**
 * 创建带错误码的 Error 对象（可被全局错误处理器识别）
 * @param {Object} 错误定义 - 错误码对象
 * @param {string} [detail] - 附加详情
 * @returns {Error} 带 errorCode 和 status 属性的 Error
 */
export function 创建业务错误(错误定义, detail) {
  const err = new Error(detail || 错误定义.message);
  err.errorCode = 错误定义.code;
  err.status = 错误定义.status;
  return err;
}

/**
 * 从 Error 对象中提取错误码信息
 * 用于全局错误处理器识别业务错误
 * @param {Error} err
 * @returns {{ errorCode: string, status: number, message: string } | null}
 */
export function 解析错误码(err) {
  if (!err.errorCode) return null;
  const def = Object.values(错误码).find(d => d.code === err.errorCode);
  if (!def) return null;
  return {
    errorCode: def.code,
    status: err.status || def.status,
    message: err.message || def.message,
  };
}

export default { 错误码, 创建错误响应, 创建业务错误, 解析错误码 };
