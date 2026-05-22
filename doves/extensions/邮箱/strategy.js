/**
 * 邮箱代理规划策略
 * 扩展 = 能力组 + 流程案例
 *
 * 描述可用工具能力 + 提供流程案例参考
 * LLM 根据用户实际请求自行决策工具组合
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【邮箱能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 连接配置工具',
  '   email_config(list/add)：查看/添加邮箱配置',
  '   email_connect：验证邮箱连接',
  '',
  '2. 邮件获取工具',
  '   email_list：浏览收件箱（支持筛选）',
  '   email_read：阅读邮件（含附件列表和正文）',
  '   email_search：搜索邮件（关键词/发件人/日期）',
  '',
  '3. 分析处理工具',
  '   email_classify：LLM分类（重要/普通/垃圾/待办）',
  '   email_summarize：批量邮件摘要',
  '',
  '4. 行动执行工具',
  '   email_send：发送邮件（dangerous，需确认）',
  '   email_reply：回复邮件（dangerous，需确认）',
  '   email_forward：转发邮件',
  '   email_draft：生成草稿（不发送）',
  '   email_attachment_save：保存附件',
  '',
  '【流程案例】（参考，非强制）',
  '- 查收邮件：email_list → email_read',
  '- 邮件摘要：email_list → email_summarize',
  '- 回复邮件：email_read(查看原邮件) → email_reply(回复)',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 发送/回复邮件必须获得用户确认',
  '- 删除邮件前必须展示邮件预览',
  '- 邮箱密码必须加密存储',
].join('\n');

const 输出格式 = '"emailOperation": {\n    "operationType": "fetch|read|send|reply|classify|summarize|search|config",\n    "emailCount": 0,\n    "requiresConfirmation": false\n  },';

const 方法论指引 = '请根据用户实际需求，从邮箱能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。';

export default {
  strategies: {
    email_agent: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        '邮箱处理',
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
