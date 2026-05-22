/**
 * 余弦相似度计算
 */

/**
 * 计算两个向量的余弦相似度
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} -1 到 1 之间
 */
export function 余弦相似度(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 对候选集计算相似度并排序，返回 top-K
 * @param {number[]} queryVec - 查询向量
 * @param {Array<{向量: number[], [key: string]: any}>} candidates - 候选文档（必须含"向量"字段）
 * @param {number} topK - 返回数量
 * @param {number} 阈值 - 最低相似度（低于此值不返回）
 * @returns {Array<{相似度: number, [key: string]: any}>}
 */
export function 批量排序(queryVec, candidates, topK = 10, 阈值 = 0) {
  const scored = [];

  for (const doc of candidates) {
    const 分数 = 余弦相似度(queryVec, doc.向量);
    if (分数 >= 阈值) {
      scored.push({ ...doc, 相似度: 分数 });
    }
  }

  scored.sort((a, b) => b.相似度 - a.相似度);
  return scored.slice(0, topK);
}
