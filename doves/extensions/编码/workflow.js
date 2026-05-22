/**
 * 编码能力组声明
 * 扩展 = 能力组 + 流程案例
 *
 * 能力组：原子工具分组，对白鸽始终可见、可独立调用
 * 流程案例：常见组合模式参考，非强制约束
 */
export default {
  场景: ['编程', '代码', '写代码', '改代码', '调试', '重构', '修bug', '开发功能'],

  能力组: [
    {
      名称: '研究理解',
      触发关键词: ['看看代码', '了解一下', '代码在哪', '怎么实现的', '分析代码', '读代码'],
      说明: '用代码读取/符号分析/LSP工具理解代码结构、逻辑和依赖关系',
      工具: ['code_read_file', 'code_document_symbols', 'code_goto_definition', 'code_find_references', 'code_hover_info', 'code_semantic_search', 'code_list_dir'],
    },
    {
      名称: '精准修改',
      触发关键词: ['改一下', '修改代码', '写代码', '新增功能', '修bug', '重构', '实现'],
      说明: '用代码编辑精准搜索替换，只修改达成目标所需的最少代码行',
      工具: ['code_edit', 'code_create_file'],
    },
    {
      名称: '验证确认',
      触发关键词: ['检查一下', '跑一下', '有没有问题', '测试', '验证'],
      说明: '用代码读取确认修改正确，用 LSP 诊断检查错误，运行相关测试',
      工具: ['code_read_file', 'code_check_problems', 'code_terminal_run', 'code_terminal_output'],
    },
  ],

  流程案例: [
    {
      名称: '新增功能',
      适用场景: '用户说"加个功能"、"新增xxx"',
      流程: 'code_read_file(理解代码) → code_edit(修改代码) → code_check_problems(验证)',
    },
    {
      名称: '修Bug',
      适用场景: '用户说"修bug"、"这里报错了"',
      流程: 'code_read_file(定位问题) → code_edit(修复) → code_terminal_run(测试验证)',
    },
    {
      名称: '代码阅读',
      适用场景: '用户说"看看代码"、"帮我理解"',
      流程: 'code_document_symbols → code_read_file / code_goto_definition / code_find_references',
    },
  ],

  关键规则: [
    '流程案例仅供参考，根据用户实际需求灵活组合工具',
    '研究先行：动手改代码前先理解现有逻辑',
    '精准修改：用代码编辑而非文件写入，只改必要的行',
    '编辑后验证：每组修改后确认语法正确',
    '禁止用执行命令做代码读写',
  ],
};
