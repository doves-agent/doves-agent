/**
 * 语义记忆数据层
 * 通过 ctx.memory 持久化 AI 分析结论和用户偏好
 * 支持跨设备语义检索
 */

let _ctx = null;

export function setContext(ctx) {
  _ctx = ctx;
}

function getMemory() {
  if (!_ctx) throw new Error('[Git版本控制/记忆] DoveAppContext 未注入');
  return _ctx.memory;
}

/**
 * 记录用户偏好（merge策略、commit风格等）
 */
export async function 记录偏好({ 仓库, 类别, 内容 }) {
  const memory = getMemory();
  await memory.write({
    content: `[Git偏好][${类别}] 仓库: ${仓库} — ${内容}`,
    metadata: {
      类别: 'git_偏好',
      子类别: 类别,
      仓库,
    },
  });
}

/**
 * 记录 AI 分析结论（重要发现、风险提示等）
 */
export async function 记录结论({ 仓库, 类型, 结论, commit }) {
  const memory = getMemory();
  await memory.write({
    content: `[Git分析结论][${类型}] 仓库: ${仓库} — ${结论}`,
    metadata: {
      类别: 'git_结论',
      子类别: 类型,
      仓库,
      commit: commit || null,
    },
  });
}

/**
 * 语义查询偏好/结论
 */
export async function 查询偏好(query, options = {}) {
  const memory = getMemory();
  const results = await memory.search(query, {
    limit: options.limit || 10,
    ...options,
  });
  return results;
}

/**
 * 查询特定仓库相关的记忆
 */
export async function 查询仓库记忆(仓库别名, query) {
  const memory = getMemory();
  const searchQuery = 仓库别名 ? `仓库: ${仓库别名} ${query || ''}` : query;
  return await memory.search(searchQuery, { limit: 10 });
}

/**
 * 删除过时记忆
 */
export async function 删除记忆(id) {
  const memory = getMemory();
  await memory.delete(id);
}
