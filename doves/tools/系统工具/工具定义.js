/**
 * @file tools/系统工具/工具定义
 * @description 系统工具定义数组
 */

export const systemTools = [
  {
    name: '系统信息',
    description: '获取系统信息（CPU、内存、操作系统等）',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: '环境变量',
    description: '获取用户环境变量',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '指定环境变量名，不填则返回全部' }
      }
    }
  },
  {
    name: '常用路径',
    description: '获取用户常用路径（桌面、文档、下载等）',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: '网络信息',
    description: '获取网络接口信息',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: '执行命令',
    description: '执行系统命令（谨慎使用）',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        timeout: { type: 'number', description: '超时时间(ms)', default: 30000 },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['command']
    }
  },
  {
    name: '磁盘信息',
    description: '获取磁盘使用情况',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '磁盘路径，如 C:\\ 或 /' }
      }
    }
  },
  {
    name: '进程列表',
    description: '获取运行中的进程列表',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: '进程名过滤（可选）' }
      }
    }
  },
  {
    name: '日期时间',
    description: '获取当前日期时间信息',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', description: '日期格式，如 YYYY-MM-DD' },
        timezone: { type: 'string', description: '时区，如 Asia/Shanghai' }
      }
    }
  },
  {
    name: '查询任务',
    description: '通过任务ID查询任务的详细信息（描述、状态、结果等）。当你需要获取其他任务（如父任务、前置子任务）的执行结果时使用此工具。例如：子任务2需要使用子任务1的输出结果时，可通过任务ID查询获取。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '要查询的任务ID（如 task_sub_xxx 或 task_branch_xxx）' }
      },
      required: ['task_id']
    }
  },
  {
    name: '关联任务',
    description: '列出与当前任务相关的其他任务（父任务、兄弟子任务）。当你的任务依赖于其他子任务的结果时，先调用此工具获取相关任务列表和ID，再用 查询任务 查询具体结果。',
    inputSchema: {
      type: 'object',
      properties: {
        parent_task_id: { type: 'string', description: '父任务ID，用于查询其下所有子任务' },
        status_filter: { type: 'string', description: '按状态过滤：completed / failed / running / pending，不填则返回全部' }
      }
    }
  },
  {
    name: '发现能力',
    description: '查询可用的技能和工具能力列表。[限制]返回的是已注册能力的元数据，不代表每个能力都能成功执行（部分依赖API Key或外部服务）。当你觉得当前可用的工具/技能不够用，或者需要寻找更适合当前任务的能力时，调用此工具发现更多能力。下一轮对话中将自动包含新发现的工具。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，如"文件操作"、"网络请求"、"数据处理"等' },
        depth: { type: 'string', enum: ['summary', 'detail'], description: '信息深度：summary=分类摘要（默认），detail=详细技能列表' }
      }
    }
  },
  {
    name: '电源控制',
    description: '系统电源控制：关机、重启、休眠、锁屏。⚠️ 这是高风险操作，执行前必须先使用 询问用户 工具向用户确认！',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['shutdown', 'reboot', 'sleep', 'lock'], description: '电源操作：shutdown=关机, reboot=重启, sleep=休眠, lock=锁屏' },
        delay: { type: 'number', description: '延迟秒数（默认5秒，给用户反悔时间）' },
        reason: { type: 'string', description: '操作原因（记录日志）' }
      },
      required: ['action']
    }
  }
];
