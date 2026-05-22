/**
 * @file circuit-breaker
 * @description LLM 提供商熔断器
 * 
 * 三态模型：关闭(正常) → 打开(熔断) → 半开(试探)
 * - 连续失败达到阈值 → 打开（拒绝请求）
 * - 冷却期后 → 半开（允许少量试探）
 * - 试探成功 → 关闭（恢复正常）
 * - 试探失败 → 重新打开
 */

// ========== 熔断状态 ==========
const STATE = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' };

// ========== 配置 ==========
const FAILURE_THRESHOLD = 5;     // 连续失败次数阈值
const COOLDOWN_MS = 30000;       // 熔断冷却期（30秒）
const HALF_OPEN_MAX_TRIES = 1;   // 半开状态最大试探次数

// ========== 每个提供商的熔断状态 ==========
const breakers = new Map();

function getBreaker(provider) {
  if (!breakers.has(provider)) {
    breakers.set(provider, {
      state: STATE.CLOSED,
      failureCount: 0,
      openedAt: 0,       // 进入打开状态的时间
      halfOpenTries: 0,  // 半开状态已试探次数
    });
  }
  return breakers.get(provider);
}

/**
 * 判断提供商是否已熔断（应拒绝请求）
 */
export function 是否熔断(provider) {
  const b = getBreaker(provider);
  
  if (b.state === STATE.CLOSED) return false;
  
  if (b.state === STATE.OPEN) {
    // 冷却期已过 → 进入半开
    if (Date.now() - b.openedAt >= COOLDOWN_MS) {
      b.state = STATE.HALF_OPEN;
      b.halfOpenTries = 0;
      return false;
    }
    return true; // 仍在冷却期，熔断中
  }
  
  // 半开状态：已用完试探配额 → 仍熔断
  if (b.state === STATE.HALF_OPEN && b.halfOpenTries >= HALF_OPEN_MAX_TRIES) {
    return true;
  }
  
  return false;
}

/**
 * 记录调用成功 → 重置熔断器
 */
export function 记录成功(provider) {
  const b = getBreaker(provider);
  b.failureCount = 0;
  b.state = STATE.CLOSED;
  b.halfOpenTries = 0;
}

/**
 * 记录调用失败 → 累计失败次数，达到阈值则熔断
 */
export function 记录失败(provider) {
  const b = getBreaker(provider);
  b.failureCount++;
  
  if (b.state === STATE.HALF_OPEN) {
    // 半开试探失败 → 重新熔断
    b.state = STATE.OPEN;
    b.openedAt = Date.now();
    b.halfOpenTries = 0;
    return;
  }
  
  if (b.failureCount >= FAILURE_THRESHOLD) {
    b.state = STATE.OPEN;
    b.openedAt = Date.now();
  }
}

/**
 * 记录半开试探（在是否熔断检查后调用，递增试探计数）
 */
export function 记录半开尝试(provider) {
  const b = getBreaker(provider);
  if (b.state === STATE.HALF_OPEN) {
    b.halfOpenTries++;
  }
}

/**
 * 获取熔断状态（用于诊断/监控）
 */
export function 获取熔断状态(provider) {
  if (!provider) {
    // 无参数：返回所有提供商的熔断状态
    const all = {};
    for (const [name, b] of breakers) {
      all[name] = {
        state: b.state,
        failureCount: b.failureCount,
        openedAt: b.openedAt || null,
        halfOpenTries: b.halfOpenTries,
      };
    }
    return all;
  }
  const b = getBreaker(provider);
  return {
    state: b.state,
    failureCount: b.failureCount,
    openedAt: b.openedAt || null,
    halfOpenTries: b.halfOpenTries,
  };
}