/**
 * 人类分身执行增强
 * 提供条件性系统提示词，引导 LLM 使用分身工具链
 */
export default {
  conditionalPrompts: [
    {
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['分身', '语气学习', '聊天记录', '自动回复'].includes(a));
      },
      prompt: `【分身工具使用指引】
- 导入聊天记录 → avatar_import_chat（所有数据仅存储本地Git存储）
- 查看记录 → avatar_chat_history
- 语气分析 → avatar_analyze_style
- 语气档案 → avatar_style_profile
- 生成回复 → avatar_generate_reply
- 上下文检索 → avatar_search_context
- 发送回复 → avatar_send_reply（需用户确认）
- 分身配置 → avatar_config
- 增量训练 → avatar_train

【隐私安全规则】
- 聊天记录只存用户自己的Git存储，不上传公共服务器
- 分身只能模拟用户自己的语气，不允许模拟他人
- 发送回复前必须使用 询问用户 向用户确认内容
- 用户可随时删除聊天记录和语气档案
- 自动发送功能必须用户显式启用`,
    },
  ],

  // hooks: 已就绪，分身工具全链路（导入→分析→回复→发送）均可通过工具直接调用
};
