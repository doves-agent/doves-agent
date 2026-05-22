/**
 * @file 分身工具-定义.js
 * @description 人类分身工具的 extTools 定义，从 分身工具.js 抽取
 * 9个分身工具：导入聊天记录 → 语气学习 → 回复生成 → 配置管理
 */

export const extTools = [
  // ========== 数据导入 ==========
  {
    name: 'avatar_import_chat',
    description: '导入聊天记录到Git记忆，为语气学习准备数据源。支持微信/WhatsApp/Telegram导出格式（txt/html）。所有数据仅存储在用户本地Git仓库中。',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['wechat', 'whatsapp', 'telegram', 'auto'], description: '聊天记录来源平台，auto=自动检测', default: 'auto' },
        filePath: { type: 'string', description: 'Git存储中聊天记录文件的路径' },
        content: { type: 'string', description: '聊天记录文本内容（直接传入，与filePath二选一）' },
        ownerName: { type: 'string', description: '用户自己的名字（用于从聊天记录中识别自己发送的消息）' },
        contactName: { type: 'string', description: '对话对象的名字（可选，用于限定分析范围）' },
        timeRange: {
          type: 'object',
          description: '时间范围筛选（可选）',
          properties: {
            start: { type: 'string', description: '开始日期（YYYY-MM-DD）' },
            end: { type: 'string', description: '结束日期（YYYY-MM-DD）' },
          },
        },
      },
      required: ['ownerName'],
    },
  },
  // ========== 语气学习 ==========
  {
    name: 'avatar_analyze_style',
    description: '分析导入的聊天记录，提取用户的语气特征：口头禅、句式偏好、emoji使用习惯、语气强度、正式度等。结果自动存入语气档案。',
    inputSchema: {
      type: 'object',
      properties: {
        ownerName: { type: 'string', description: '用户自己的名字（从聊天记录中识别自己的消息）' },
        sampleSize: { type: 'number', description: '分析的样本消息数（默认500，最大2000）', default: 500 },
        focusAreas: {
          type: 'array',
          items: { type: 'string', enum: ['口头禅', '句式', 'emoji', '语气强度', '正式度', '回复速度', '常用话题', 'all'] },
          description: '重点分析的语气维度，默认全部',
          default: ['all'],
        },
        memoryId: { type: 'string', description: '已导入聊天记录的Git记忆ID（不传则分析最近导入的）' },
      },
      required: ['ownerName'],
    },
  },
  {
    name: 'avatar_style_profile',
    description: '查看、编辑或重置用户的语气档案。语气档案决定分身回复时的语气风格。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['view', 'update', 'reset', 'export'], description: '操作类型：view=查看，update=更新特定字段，reset=重置全部，export=导出档案' },
        updates: {
          type: 'object',
          description: '要更新的语气档案字段（action=update时使用）',
          properties: {
            口头禅: { type: 'array', items: { type: 'string' }, description: '常用口头禅列表' },
            语气强度: { type: 'number', description: '语气强度 0~1' },
            正式度: { type: 'number', description: '正式度 0~1' },
            回复速度: { type: 'string', enum: ['快速', '中等', '慢速'] },
            拒答话题: { type: 'array', items: { type: 'string' }, description: '不回复的话题列表' },
          },
        },
      },
      required: ['action'],
    },
  },
  // ========== 回复生成 ==========
  {
    name: 'avatar_generate_reply',
    description: '根据收到的消息、对话上下文和用户语气档案，生成符合用户语气的分身回复。生成后需用户确认才能发送。',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '收到的消息内容' },
        sender: { type: 'string', description: '消息发送者名字（可选，用于检索与该人的历史对话）' },
        contextCount: { type: 'number', description: '检索历史上下文条数（默认5）', default: 5 },
        styleIntensity: { type: 'number', description: '语气强度 0~1（默认使用档案配置值）' },
        tone: { type: 'string', enum: ['auto', 'casual', 'formal', 'humorous', 'concise'], description: '期望的语气风格，auto=使用档案配置', default: 'auto' },
        customInstruction: { type: 'string', description: '额外的回复要求（如"用反问语气"、"控制在20字内"）' },
      },
      required: ['message'],
    },
  },
  {
    name: 'avatar_send_reply',
    description: '通过IM通道发送分身回复。默认需要用户确认，可配置自动发送（需用户显式启用）。',
    inputSchema: {
      type: 'object',
      properties: {
        replyId: { type: 'string', description: 'avatar_generate_reply 生成的回复ID' },
        content: { type: 'string', description: '要发送的回复内容（可直接传入）' },
        platform: { type: 'string', enum: ['wechat', 'dingtalk', 'feishu', 'auto'], description: '发送平台，auto=自动选择', default: 'auto' },
        target: { type: 'string', description: '发送目标（如IM群ID、用户ID）' },
        autoConfirm: { type: 'boolean', description: '是否跳过用户确认直接发送（需用户已启用自动发送）', default: false },
      },
      required: ['platform'],
    },
  },
  {
    name: 'avatar_search_context',
    description: '在Git记忆中搜索与当前消息相似的对话上下文，用于辅助生成更贴合实际聊天风格的分身回复。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询（通常是当前收到的消息）' },
        sender: { type: 'string', description: '限定搜索与该发送者的历史对话（可选）' },
        limit: { type: 'number', description: '返回结果数（默认5）', default: 5 },
        timeRange: {
          type: 'object',
          description: '时间范围（可选）',
          properties: {
            start: { type: 'string', description: '开始日期' },
            end: { type: 'string', description: '结束日期' },
          },
        },
      },
      required: ['query'],
    },
  },
  // ========== 查询与管理 ==========
  {
    name: 'avatar_chat_history',
    description: '查询已导入的聊天记录，支持按时间、联系人、关键词筛选。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'search', 'stats', 'delete'], description: '操作类型：list=列出导入批次，search=关键词搜索，stats=统计概览，delete=删除记录' },
        keyword: { type: 'string', description: '搜索关键词（action=search时使用）' },
        contactName: { type: 'string', description: '按联系人筛选' },
        timeRange: {
          type: 'object',
          description: '时间范围',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
        },
        limit: { type: 'number', description: '返回条数上限', default: 20 },
        memoryId: { type: 'string', description: 'Git记忆ID（action=delete时必填）' },
      },
      required: ['action'],
    },
  },
  {
    name: 'avatar_config',
    description: '配置分身行为：自动回复规则、语气默认值、适用场景、IM通道绑定等。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['view', 'update', 'reset'], description: '操作类型' },
        config: {
          type: 'object',
          description: '配置项（action=update时使用）',
          properties: {
            自动回复启用: { type: 'boolean', description: '是否启用自动回复（启用后收到消息自动回复）' },
            自动回复场景: { type: 'array', items: { type: 'string' }, description: '自动回复适用的场景列表（如["微信私聊", "钉钉工作群"]）' },
            默认语气强度: { type: 'number', description: '默认语气强度 0~1' },
            默认正式度: { type: 'number', description: '默认正式度 0~1' },
            工作时间仅回复: { type: 'boolean', description: '是否仅在工作时间自动回复' },
            工作时间: {
              type: 'object',
              properties: {
                start: { type: 'string', description: '开始时间（HH:mm）' },
                end: { type: 'string', description: '结束时间（HH:mm）' },
              },
            },
            静默联系人: { type: 'array', items: { type: 'string' }, description: '不对这些联系人自动回复' },
            IM通道绑定: {
              type: 'object',
              description: 'IM通道与联系人映射',
              properties: {
                wechat: { type: 'string' },
                dingtalk: { type: 'string' },
                feishu: { type: 'string' },
              },
            },
          },
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'avatar_train',
    description: '用新的聊天记录增量训练语气模型，补充和更新语气档案。适用于用户语气发生变化或新增聊天场景时。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '新增的聊天记录文本' },
        filePath: { type: 'string', description: 'Git存储中新聊天记录文件的路径' },
        format: { type: 'string', enum: ['wechat', 'whatsapp', 'telegram', 'auto'], description: '聊天记录格式', default: 'auto' },
        ownerName: { type: 'string', description: '用户自己的名字' },
        mode: { type: 'string', enum: ['append', 'replace_range', 'full_retrain'], description: '训练模式：append=追加分析，replace_range=替换时间段，full_retrain=全量重训', default: 'append' },
      },
      required: ['ownerName'],
    },
  },
];
