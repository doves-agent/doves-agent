/**
 * LLM成语校验器
 * 通过LLM快速模型校验成语/词语合法性
 */
export default {
  /**
   * 校验成语
   * @param {string} text - 待校验的文本
   * @returns {Promise<{valid, type, meaning, source?, suggestion?}>}
   */
  async 校验成语(text) {
    // 尝试使用白鸽的LLM能力进行校验
    try {
      const { 调用LLM } = await import('../../providers/index.js');
      if (typeof 调用LLM === 'function') {
        const prompt = `校验中文成语/词语合法性。

规则:
1. 四字成语 → type: "idiom"
2. 二字或多字合法词语 → type: "word"
3. 无效输入 → type: "invalid"

严格返回JSON:
${'{"valid": true/false, "type": "idiom"|"word"|"invalid", "meaning": "释义(仅valid=true)", "source": "出处(可选)", "suggestion": "建议替换(仅valid=false)"}'}

输入: ${text}`;

        const result = await 调用LLM({
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 200,
        });

        if (result && result.content) {
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
              valid: !!parsed.valid,
              type: parsed.type || 'invalid',
              meaning: parsed.meaning || '',
              source: parsed.source || '',
              suggestion: parsed.suggestion || '',
            };
          }
        }
      }
    } catch (e) {
      // LLM不可用，向上层抛出异常
      throw e;
    }

    // 如果LLM未返回有效结果，抛出异常
    throw new Error('LLM校验未返回有效结果');
  },
};
