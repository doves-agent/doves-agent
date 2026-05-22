/**
 * @file tools/用户交互/工具定义
 * @description 用户交互工具定义与问题类型
 */

export const QUESTION_TYPES = {
  SINGLE_CHOICE: 'single_choice',
  MULTI_CHOICE: 'multi_choice',
  TEXT_INPUT: 'text_input',
  CONFIRMATION: 'confirmation'
};

export const interactionTools = [
  {
    name: '询问用户',
    description: '向用户提问并等待回答。支持单选、多选、文本输入、确认等多种问题类型。当需要用户提供信息、做出选择或确认操作时使用此工具。会阻塞等待用户响应。',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '问题内容，清晰描述需要用户做什么' },
        type: {
          type: 'string',
          enum: Object.values(QUESTION_TYPES),
          description: '问题类型：single_choice(单选)、multi_choice(多选)、text_input(文本)、confirmation(确认)',
          default: 'text_input'
        },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '选项显示文本' },
              value: { type: 'string', description: '选项值' },
              description: { type: 'string', description: '选项说明' }
            }
          },
          description: '选项列表（单选/多选时必填，每个选项必须有label和value）'
        },
        defaultAnswer: { type: 'string', description: '默认答案（用户直接确认时使用）' },
        placeholder: { type: 'string', description: '输入框占位符（文本输入时）' },
        required: { type: 'boolean', description: '是否必须回答', default: true },
        timeout: { type: 'number', description: '超时时间(秒)，0表示不超时', default: 0 },
        header: { type: 'string', description: '问题标题/标签，简短显示在选项卡上（最多12字符）', maxLength: 12 },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high', '危险'],
          description: '工具风险等级，dangerous时触发IM确认推送',
          default: 'low'
        }
      },
      required: ['question']
    }
  },
  {
    name: '通知用户',
    description: '向用户发送通知消息，用于告知用户某些信息或状态变化',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '通知内容' },
        type: { type: 'string', enum: ['info', 'success', 'warning', 'error'], description: '通知类型', default: 'info' },
        duration: { type: 'number', description: '显示时长(毫秒)，0表示不自动关闭', default: 5000 }
      },
      required: ['message']
    }
  },
  {
    name: '进度更新',
    description: '向用户显示进度信息，用于长时间操作时告知用户当前进度',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '进度消息' },
        progress: { type: 'number', description: '进度百分比 (0-100)' },
        status: { type: 'string', enum: ['等待中', '进行中', '已完成', '失败'], description: '状态' }
      },
      required: ['message']
    }
  }
];
