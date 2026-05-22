/**
 * @file server/config
 * @description 服务端配置常量，从 index.js 拆分
 * 包含 API 版本管理、协议文档定义等配置数据
 */

// ==================== API 版本管理 ====================

export const API_VERSIONS = {
  current: 'v1',
  supported: ['v1'],
  versionInfo: {
    v1: {
      version: '1.0.0',
      releasedAt: '2025-01-01',
      endpoints: {
        '/api/task': '任务执行协议',
        '/api/skill': '技能执行协议',
        '/api/dove': '鸽子生命周期协议',
        '/api/dove/heartbeat': '心跳协议',
        '/api/dove/capabilities': '能力增量更新',
        '/api/dove/offline': '鸽子下线协议',
        '/api/dove/access-policy': '权限策略协议'
      },
      changelog: [
        '标准化任务执行状态机 (等待中→已就绪→执行中→已完成/失败/已终止)',
        '技能执行三步协议 (discover->schema->execute)',
        '鸽子生命周期协议 (register->heartbeat->capability_update->offline)',
        '心跳协议增强 (负载上报、能力变更、配置下发)',
        '权限策略配置接口'
      ]
    }
  }
};

/**
 * 协议文档定义
 * 每个协议端点的请求/响应结构描述，供客户端自动发现和校验
 */
export const PROTOCOL_DOCS = {
  // ==================== 任务执行协议 ====================
  task_create: {
    方法: 'POST',
    路径: '/api/task',
    描述: '创建新任务',
    请求: {
      标题: 'string (必填)',
      描述: 'string',
      优先级: 'low|medium|high|urgent',
      执行配置ID: 'string',
      能力需求: ['string'],
      截止时间: 'string (ISO 8601)',
      饲料: { 数量: 'number', 代币类型: 'string' }
    },
    响应: {
      任务ID: 'string',
      状态: '等待中',
      创建时间: 'string (ISO 8601)'
    }
  },
  task_progress: {
    方法: 'POST',
    路径: '/api/task/:taskId/progress',
    描述: '汇报任务执行进度',
    请求: {
      进度百分比: 'number (0-100)',
      当前步骤: 'string',
      消息: 'string',
      附件: [{ 名称: 'string', 类型: 'string', 大小: 'number', 路径: 'string' }]
    },
    响应: { 已接收: 'boolean' }
  },
  task_result: {
    方法: 'POST',
    路径: '/api/task/:taskId/result',
    描述: '提交任务执行结果',
    请求: {
      结果: 'any (任务输出)',
      状态: '已完成|失败',
      错误信息: 'string (失败时)',
      附件: [{ 名称: 'string', 类型: 'string', 大小: 'number', 路径: 'string' }]
    },
    响应: { 任务ID: 'string', 状态: 'string', 验证状态: 'string' }
  },
  task_cancel: {
    方法: 'POST',
    路径: '/api/task/:taskId/cancel',
    描述: '取消任务（仅饲养员或管理员）',
    请求: { 原因: 'string' },
    响应: { 任务ID: 'string', 状态: '已取消' }
  },
  task_states: {
    方法: 'META',
    路径: '/api/task',
    描述: '任务状态机定义',
    状态转换: {
      等待中: ['已就绪', '已取消'],
      已就绪: ['执行中', '已取消'],
      阻塞中: ['等待中', '已就绪', '已取消'],
      执行中: ['等待子任务', '已完成', '已完成(部分失败)', '失败', '已终止', '已取消'],
      等待子任务: ['已完成', '已完成(部分失败)', '失败', '已终止', '已取消'],
      已完成: [],
      '已完成(部分失败)': [],
      失败: ['等待中'],
      已终止: [],
      已取消: []
    }
  },

  // ==================== 技能执行协议 ====================
  skill_discover: {
    方法: 'POST',
    路径: '/api/skill/discover',
    描述: '发现可用技能',
    请求: { 能力需求: ['string'], 分类: 'string' },
    响应: { 技能列表: [{ 名称: 'string', 描述: 'string', 版本: 'string', 分类: 'string' }] }
  },
  skill_schema: {
    方法: 'GET',
    路径: '/api/skill/:name/schema',
    描述: '获取技能输入输出schema',
    响应: { 名称: 'string', 版本: 'string', 输入: 'object', 输出: 'object', 安全级别: 'string', 超时: 'number' }
  },
  skill_execute: {
    方法: 'POST',
    路径: '/api/skill/:name/execute',
    描述: '执行技能',
    请求: { 输入参数: 'object', 超时: 'number', 回调URL: 'string' },
    响应: { 执行ID: 'string', 状态: '等待中' }
  },

  // ==================== 鸽子生命周期协议 ====================
  dove_heartbeat: {
    方法: 'POST',
    路径: '/api/dove/heartbeat',
    描述: '鸽子心跳上报（含负载、能力变更）',
    请求: {
      currentTasks: ['string'],
      负载: { CPU使用率: 'number', 内存使用率: 'number', 最大任务数: 'number' },
      能力变更: [{ 操作: 'add|remove', 能力名称: 'string' }]
    },
    响应: {
      时间: 'string',
      下次心跳间隔: 'number (ms)',
      状态: 'busy|idle',
      负载: { 服务器时间: 'string', 在线鸽子数: 'number' },
      能力变更: [{ 操作: 'enable|disable|update', 能力名称: 'string', 参数: 'object', 原因: 'string' }],
      配置更新: { 权限策略: 'object' }
    }
  },
  dove_capabilities: {
    方法: 'POST',
    路径: '/api/dove/capabilities',
    描述: '鸽子增量能力更新',
    请求: {
      变更列表: [{ 操作: 'add|remove|update', 能力名称: 'string', 描述: 'string', 参数: 'object', 安全级别: 'string' }]
    },
    响应: { 总数: 'number', 成功数: 'number', 结果: 'array' }
  },
  dove_offline: {
    方法: 'POST',
    路径: '/api/dove/offline',
    描述: '鸽子主动下线',
    请求: { 原因: 'shutdown|maintenance|error', 预计恢复时间: 'string (ISO 8601)' },
    响应: { 状态: '离线', 下线时间: 'string', 中断任务数: 'number' }
  },
  dove_access_policy: {
    方法: 'GET|PUT',
    路径: '/api/dove/:doveId/access-policy',
    描述: '获取/更新鸽子权限策略（PUT需管理员）',
    请求_PUT: { 数据访问范围: 'task_only|user_all', 最大单次查询量: 'number (1-1000)' },
    响应: { doveId: 'string', 数据访问范围: 'string', 最大单次查询量: 'number' }
  }
};
