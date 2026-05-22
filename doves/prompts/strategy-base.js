/**
 * @file prompts/strategy-base
 * @description 策略提示词共享骨架，所有策略提示词复用
 */

/**
 * 生成策略提示词（共享骨架）
 * @param {string} 策略名 - 策略显示名称
 * @param {string} 方法论段落 - 该策略的方法论内容
 * @param {string} 输出格式扩展 - 策略特有的输出字段
 * @param {number} 最大子任务数 - 当前允许的最大子任务数
 * @param {number} 当前深度 - 当前递归深度
 * @returns {string} 系统提示词
 */
export const 生成策略提示词 = (策略名, 方法论段落, 输出格式扩展, 最大子任务数, 当前深度) => {
  return `${策略名}规划。

${方法论段落}

拆分约束:
- 禁止前几个具体+"完成剩余"偷懒拆分
- 禁止大量工作打包为一个巨大子任务
- 均匀分组，每个子任务工作量大致均等

当前深度: 第${当前深度 + 1}层（共3层） | 最大子任务数: ${最大子任务数}

子任务规则:
- 自包含: 描述完整，不依赖其他子任务输出
- 精简: 一句话说清楚
- 禁止引用: 不用"上面的结果"、"前一个任务"等
- 依赖通过 dependencies 字段标注
- 合理利用并行
- description 明确HOW: 网络信息→"使用 网络搜索 搜索..."、文件操作→"读取 /path/to/file..."、代码执行→"使用 执行命令 运行..."、LLM推理→"根据已有信息分析..."

严格返回JSON:
{
  "complexity": "medium|high",
  "reason": "判断原因",
  "strategy": "${策略名}",
  ${输出格式扩展}
  "subTasks": [
    {
      "id": "sub_1",
      "description": "使用 网络搜索 搜索XXX的前5条结果",
      "role": "collector|analyst|aggregator|validator|creator|coder|git_analyst",
      "skill": "llm_tool_call",
      "abilities": ["搜索"],
      "toolRiskLevel": "safe|caution|dangerous",
      "params": {},
      "dependencies": [],
      "needsDecomposition": false
    }
  ]
}

字段:
- abilities: 能力关键词（文档/代码/搜索/网络/系统/Shell/数据库/图片/视频/GUI）
- toolRiskLevel: safe=只读 | caution=写入 | dangerous=命令执行
- role: collector=收集 | analyst=分析 | aggregator=汇总 | validator=验证 | creator=创作 | coder=编码 | git_analyst=Git分析
- needsDecomposition: false=直接执行 | true=继续拆分`;
};

/**
 * 生成用户提示词（通用）
 * @param {string} 任务描述
 * @param {Array} 可用能力
 * @param {Array} 可用技能
 * @param {string} 方法论指引 - 附加的方法论指引语
 * @returns {string} 用户提示词
 */
export const 生成用户提示词 = (任务描述, 可用能力 = [], 可用技能 = [], 方法论指引 = '') => {
  return `请分析以下任务：

---
${任务描述}
---

【可用能力】
${可用能力.length > 0 ? 可用能力.map(a => `- ${a.名称 || a.name || a}: ${a.描述 || a.description || ''}`).join('\n') : '- 推理: 通用推理能力\n- 搜索: 网络搜索能力'}

【可用技能】
${可用技能.length > 0 ? 可用技能.map(s => `- ${s.name}: ${s.desc || s.description || ''}`).join('\n') : '- llm_tool_call: LLM工具调用（默认）'}

${方法论指引}
请按方法论规划，返回 JSON。`;
};

export default { 生成策略提示词, 生成用户提示词 };
