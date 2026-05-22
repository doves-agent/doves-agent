/**
 * @file 邮箱工具-定义.js
 * @description 邮箱工具的工具定义、安全分级、分类、能力映射，从 邮箱工具.js 抽取
 */

// ==================== 工具定义 ====================

export const extTools = [
  // ---------- 邮箱配置 ----------
  {
    name: 'email_config',
    description: '管理邮箱账号配置：查看/保存/测试邮箱连接配置',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'save', 'test', 'delete'], description: '操作类型：list=查看配置，save=保存新配置，test=测试连接，delete=删除配置' },
        configId: { type: 'string', description: '配置标识（list时不需要，其他操作必填）' },
        config: {
          type: 'object',
          description: '邮箱配置（save时必填）',
          properties: {
            email: { type: 'string', description: '邮箱地址' },
            pop3Host: { type: 'string', description: 'POP3服务器地址' },
            pop3Port: { type: 'number', description: 'POP3端口，默认995（SSL）' },
            smtpHost: { type: 'string', description: 'SMTP服务器地址' },
            smtpPort: { type: 'number', description: 'SMTP端口，默认465（SSL）' },
            username: { type: 'string', description: '用户名（通常是邮箱地址）' },
            password: { type: 'string', description: '密码或授权码' },
            useSSL: { type: 'boolean', description: '是否使用SSL（默认true）' },
          }
        }
      },
      required: ['action']
    }
  },
  // ---------- 邮件列表 ----------
  {
    name: 'email_list',
    description: '列出邮件列表，支持按数量/未读/发件人/主题筛选',
    inputSchema: {
      type: 'object',
      properties: {
        configId: { type: 'string', description: '邮箱配置标识' },
        maxCount: { type: 'number', description: '最大返回数量，默认20', default: 20 },
        unread: { type: 'boolean', description: '仅未读邮件（默认false）', default: false },
        folder: { type: 'string', description: '文件夹（默认INBOX）', default: 'INBOX' },
      },
      required: ['configId']
    }
  },
  // ---------- 阅读邮件 ----------
  {
    name: 'email_read',
    description: '阅读指定邮件的完整内容，包括正文、发件人、收件人、附件列表',
    inputSchema: {
      type: 'object',
      properties: {
        configId: { type: 'string', description: '邮箱配置标识' },
        emailId: { type: 'number', description: '邮件序号' },
        includeBody: { type: 'boolean', description: '是否包含正文内容（默认true）', default: true },
      },
      required: ['configId', 'emailId']
    }
  },
  // ---------- 搜索邮件 ----------
  {
    name: 'email_search',
    description: '按关键词/发件人/日期范围搜索邮件',
    inputSchema: {
      type: 'object',
      properties: {
        configId: { type: 'string', description: '邮箱配置标识' },
        keyword: { type: 'string', description: '搜索关键词（可选）' },
        from: { type: 'string', description: '发件人（可选）' },
        startDate: { type: 'string', description: '开始日期 YYYY-MM-DD（可选）' },
        endDate: { type: 'string', description: '结束日期 YYYY-MM-DD（可选）' },
        maxCount: { type: 'number', description: '最大返回数量，默认20', default: 20 },
      },
      required: ['configId']
    }
  },
  // ---------- 发送邮件 ----------
  {
    name: 'email_send',
    description: '发送邮件（需要用户确认）',
    inputSchema: {
      type: 'object',
      properties: {
        configId: { type: 'string', description: '邮箱配置标识' },
        to: { type: 'string', description: '收件人地址（多个用逗号分隔）' },
        cc: { type: 'string', description: '抄送（可选）' },
        bcc: { type: 'string', description: '密送（可选）' },
        subject: { type: 'string', description: '邮件主题' },
        body: { type: 'string', description: '邮件正文（纯文本或HTML）' },
        isHtml: { type: 'boolean', description: '是否为HTML格式（默认false）', default: false },
        attachments: {
          type: 'array',
          description: '附件列表（可选）',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: '附件文件名' },
              path: { type: 'string', description: '附件路径' },
            }
          }
        },
      },
      required: ['configId', 'to', 'subject', 'body']
    }
  },
  // ---------- 回复邮件 ----------
  {
    name: 'email_reply',
    description: '回复指定邮件（AI生成回复内容后用户确认再发送）',
    inputSchema: {
      type: 'object',
      properties: {
        configId: { type: 'string', description: '邮箱配置标识' },
        emailId: { type: 'number', description: '要回复的邮件序号' },
        replyBody: { type: 'string', description: '回复正文' },
        replyAll: { type: 'boolean', description: '是否回复全部（默认false）', default: false },
      },
      required: ['configId', 'emailId', 'replyBody']
    }
  },
  // ---------- 转发邮件 ----------
  {
    name: 'email_forward',
    description: '转发指定邮件',
    inputSchema: {
      type: 'object',
      properties: {
        configId: { type: 'string', description: '邮箱配置标识' },
        emailId: { type: 'number', description: '要转发的邮件序号' },
        to: { type: 'string', description: '转发目标邮箱地址' },
        additionalNote: { type: 'string', description: '转发时的附言（可选）' },
      },
      required: ['configId', 'emailId', 'to']
    }
  },
  // ---------- 邮件分类 ----------
  {
    name: 'email_classify',
    description: '邮件分类（LLM分类：重要/普通/垃圾/待办/通知/账单）',
    inputSchema: {
      type: 'object',
      properties: {
        emails: {
          type: 'array',
          description: '要分类的邮件列表（从email_list结果传入）',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              from: { type: 'string' },
              subject: { type: 'string' },
              date: { type: 'string' },
            }
          }
        },
        customCategories: {
          type: 'string',
          description: '自定义分类列表（逗号分隔，可选，默认：重要,普通,垃圾,待办,通知,账单）',
        },
      },
      required: ['emails']
    }
  },
  // ---------- 邮件摘要 ----------
  {
    name: 'email_summarize',
    description: '邮件摘要汇总：将多封邮件的关键信息汇总为要点总结',
    inputSchema: {
      type: 'object',
      properties: {
        emails: {
          type: 'array',
          description: '要摘要的邮件列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              from: { type: 'string' },
              subject: { type: 'string' },
              snippet: { type: 'string' },
              date: { type: 'string' },
            }
          }
        },
        summaryType: {
          type: 'string',
          enum: ['brief', 'detailed', 'action_items', 'all'],
          description: '摘要类型：brief=简短要点，detailed=详细摘要，action_items=待办事项，all=全部',
          default: 'brief'
        },
      },
      required: ['emails']
    }
  },
  // ---------- 生成草稿 ----------
  {
    name: 'email_draft',
    description: '生成邮件草稿（不发送，仅保存到本地草稿）',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '收件人地址' },
        cc: { type: 'string', description: '抄送（可选）' },
        subject: { type: 'string', description: '邮件主题' },
        body: { type: 'string', description: '邮件正文' },
        replyToEmailId: { type: 'number', description: '如果是回复草稿，指定原邮件ID（可选）' },
      },
      required: ['to', 'subject', 'body']
    }
  },
  // ---------- 保存附件 ----------
  {
    name: 'email_attachment_save',
    description: '将邮件附件保存到本地指定路径',
    inputSchema: {
      type: 'object',
      properties: {
        configId: { type: 'string', description: '邮箱配置标识' },
        emailId: { type: 'number', description: '邮件序号' },
        attachmentIndex: { type: 'number', description: '附件索引（从0开始）' },
        savePath: { type: 'string', description: '保存路径（含文件名）' },
      },
      required: ['configId', 'emailId', 'attachmentIndex', 'savePath']
    }
  },
];

// ==================== 工具安全分级 ====================

export const extToolSafetyLevels = {
  email_config: '谨慎',
  email_list: '安全',
  email_read: '安全',
  email_search: '安全',
  email_send: '危险',
  email_reply: '危险',
  email_forward: '谨慎',
  email_classify: '安全',
  email_summarize: '安全',
  email_draft: '谨慎',
  email_attachment_save: '谨慎',
};

// ==================== 工具分类 ====================

export const extToolCategories = {
  '邮箱管理': ['email_config'],
  '邮件处理': ['email_list', 'email_read', 'email_search', 'email_attachment_save'],
  '邮件发送': ['email_send', 'email_reply', 'email_forward', 'email_draft'],
  '邮件分类': ['email_classify'],
  '邮件摘要': ['email_summarize'],
};

// ==================== 工具能力映射 ====================

export const extToolAbilityMap = {
  email_config: ['邮箱管理'],
  email_list: ['邮件处理', '邮箱管理'],
  email_read: ['邮件处理'],
  email_search: ['邮件处理'],
  email_send: ['邮件发送', '邮箱管理'],
  email_reply: ['邮件发送', '邮箱管理'],
  email_forward: ['邮件发送'],
  email_classify: ['邮件分类'],
  email_summarize: ['邮件摘要'],
  email_draft: ['邮件发送'],
  email_attachment_save: ['邮件处理'],
};

// ==================== 工具函数 ====================

export function text(content) {
  return {
    content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
  };
}

export function error(msg) {
  return {
    content: [{ type: 'text', text: msg }],
    isError: true
  };
}
