/**
 * 人类分身规划策略
 * 分身能力组 + 流程案例
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【人类分身能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 数据导入工具',
  '   avatar_import_chat：导入聊天记录（支持微信/WhatsApp/Telegram格式）',
  '   avatar_chat_history：查看导入结果（数据量/时间范围）',
  '',
  '2. 语气学习工具',
  '   avatar_analyze_style：分析语气特征（口头禅/句式/emoji偏好/语气强度/正式度）',
  '   avatar_style_profile：查看和调整语气档案',
  '',
  '3. 回复生成工具',
  '   avatar_generate_reply：根据消息+上下文+语气档案生成回复',
  '   avatar_search_context：检索Git记忆中相似的对话上下文',
  '   avatar_send_reply：发送回复（需用户确认，可配置自动发送）',
  '',
  '4. 配置管理工具',
  '   avatar_config：配置自动回复规则/语气强度/适用场景',
  '   avatar_train：增量训练（新聊天记录补充）',
  '',
  '【流程案例】（参考，非强制）',
  '- 首次使用：avatar_import_chat(导入记录) → avatar_analyze_style(学习语气) → avatar_style_profile(查看档案)',
  '- 生成回复：avatar_search_context(检索上下文) → avatar_generate_reply(生成回复) → avatar_send_reply(确认发送)',
  '- 增量训练：avatar_import_chat(补充新记录) → avatar_train(增量训练) → avatar_analyze_style(重新分析)',
  '- 调整配置：avatar_config(调整参数) → avatar_generate_reply(测试效果)',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 聊天记录只存用户自己的Git存储，不上传到公共服务器',
  '- 分身只能模拟用户自己的语气，不允许模拟他人',
  '- 用户可随时删除聊天记录和语气档案',
  '- 自动发送功能必须用户显式启用',
].join('\n');

const 输出格式 = `"avatarOperation": {
    "operationType": "import|analyze|generate|send|config|train|search",
    "messageCount": 0,
    "needsConfirmation": true
  },`;

const 方法论指引 = '请根据用户实际需求，从人类分身能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。所有聊天数据仅存储在用户本地Git存储，自动发送必须用户确认。';

export default {
  strategies: {
    human_avatar: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        '人类分身',
        方法论段落,
        输出格式,
        最大子任务数,
        当前深度
      ),

      用户: (任务描述, 能力列表, 可用技能 = []) => 生成用户提示词(
        任务描述,
        能力列表,
        可用技能,
        方法论指引
      ),
    },
  },
};
