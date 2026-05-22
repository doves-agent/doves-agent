/**
 * 编码执行器增强
 * 提供条件性系统提示词片段（编码工具优先级注入）
 * 迁移自 strategy-coding.js 中的【编码工具优先级】段落
 */
export default {
  // 条件性系统提示词片段
  // 当任务能力需求包含编程/代码时注入编码工具优先级指引
  conditionalPrompts: [
    {
      // 匹配条件：任务能力需求包含编程/代码
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['编程', '代码', '文件操作', '代码分析', '语义搜索', '调试'].includes(a));
      },
      // 注入到系统提示词末尾
      prompt: `【编码工具优先级】
- 读取代码 → 代码读取（不要用 文件读取，它不支持行号范围）
- 搜索代码 → code_semantic_search（语义级，自动扩展同义词；也可用 代码搜索 精准正则匹配）
- 符号分析 → code_document_symbols（LSP精确，替代旧的 符号分析）
- 导航代码 → code_goto_definition / code_find_references / code_find_implementations
- 类型信息 → code_hover_info（类型签名+文档注释）
- 调用分析 → code_call_hierarchy（入/出调用分析）
- 编辑代码 → 代码编辑（不要用 文件写入 覆盖整个文件）
- 查找文件 → 文件搜索（不要用 执行命令 + find）
- 目录结构 → 目录列表（不要用 执行命令 + ls/dir）
- Git 操作 → Git操作（结构化输出，不要用 执行命令 + git）
- 运行测试/构建 → code_terminal_run（后台执行，用 code_terminal_output 获取输出）
- 调试问题 → code_check_problems（LSP诊断优先，降级linter）`,
    },
  ],
};
