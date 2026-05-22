/**
 * AI成语选取器
 * 根据战局和策略自动选择成语/词语
 */
export default {
  /**
   * AI选取成语
   * @param {string[]} teamIdioms - 己方已选成语
   * @param {string[]} opponentIdioms - 对方已选成语
   * @param {string} gameType - 'idiom' | 'word'
   * @param {string} strategy - 'attack' | 'defense' | 'balanced'
   * @returns {Promise<{idiom, strategy, type, meaning}>}
   */
  async 选取成语(teamIdioms, opponentIdioms, gameType, strategy) {
    try {
      const { 调用LLM } = await import('../../providers/index.js');
      if (typeof 调用LLM === 'function') {
        const teamStr = teamIdioms.length > 0 ? `己方已选${gameType === 'idiom' ? '成语' : '词语'}：${teamIdioms.join('、')}\n` : '';
        const oppStr = opponentIdioms.length > 0 ? `对方已选${gameType === 'idiom' ? '成语' : '词语'}：${opponentIdioms.join('、')}\n` : '';

        const prompt = `你是一个词阵对弈游戏的AI选手。请根据战术策略选择一个合适的${gameType === 'idiom' ? '四字成语' : '词语'}。

当前策略：${strategy === 'attack' ? '攻击型' : strategy === 'defense' ? '防御型' : '均衡型'}
${teamStr}${oppStr}

要求：
1. ${strategy === 'attack' ? '选择气势凌厉的攻击性成语' : strategy === 'defense' ? '选择稳固防御的成语' : '选择灵活多变的成语'}
2. 不要和己方已选的重复
3. 优先选择常见的、大家熟悉的成语
4. 贴合当前战术意图

返回严格JSON格式(不要markdown标记)：
{"idiom":"词语","strategy":"${strategy}","type":"${gameType}","meaning":"释义说明"}`;

        const result = await 调用LLM({
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 200,
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

    throw new Error('AI选词未返回有效结果');
  },
};
