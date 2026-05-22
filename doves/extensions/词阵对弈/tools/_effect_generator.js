/**
 * LLM效果生成器
 * 分析双方成语含义和典故，生成贴合成语本意的战斗效果
 */
export default {
  /**
   * 生成战斗效果
   * @param {Array} teamLeft - 左队成语列表 [{playerId, idiom, meaning}]
   * @param {Array} teamRight - 右队成语列表
   * @param {string} gameType - 'idiom' | 'word'
   * @returns {Promise<{battleEffects, battleScene, narrative}>}
   */
  async 生成效果(teamLeft, teamRight, gameType) {
    try {
      const { 调用LLM } = await import('../../providers/index.js');
      if (typeof 调用LLM === 'function') {
        const leftStr = teamLeft.map(p => `玩家${p.playerId.slice(-4)}: "${p.idiom}"${p.meaning ? '(' + p.meaning + ')' : ''}`).join('\n');
        const rightStr = teamRight.map(p => `玩家${p.playerId.slice(-4)}: "${p.idiom}"${p.meaning ? '(' + p.meaning + ')' : ''}`).join('\n');

        const prompt = `你是一个词阵对弈游戏裁判。分析玩家们选定的${gameType === 'idiom' ? '成语' : '词语'}，生成战斗效果。

左队${gameType === 'idiom' ? '成语' : '词语'}：
${leftStr}

右队${gameType === 'idiom' ? '成语' : '词语'}：
${rightStr}

请分析每个${gameType === 'idiom' ? '成语' : '词语'}的典故含义，生成贴合成语本意的效果。
效果类型说明：
- attack: 攻击（造成伤害）
- defense: 防御（减少伤害）
- speed: 速度提升（加速行动）
- freeze: 冰冻（对手无法行动1回合）
- silence: 禁手（对手无法使用效果）
- heal: 治疗（回复生命）
- poison: 持续伤害（每回合掉血）
- clear: 清空（移除负面效果）

输出格式（严格JSON，不要markdown标记）：
{"battleEffects":[{"team":"left","playerId":"...","idiom":"...","effect":{"type":"attack","value":15,"description":"效果描述","animation":"shake|flash|pulse|freeze|shield"}},...],"battleScene":"场景描述","narrative":"战斗叙事"}`;

        const result = await 调用LLM({
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1000,
        });

        if (result && result.content) {
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        }
      }
    } catch (e) {
      throw e;
    }

    throw new Error('LLM效果生成未返回有效结果');
  },
};
