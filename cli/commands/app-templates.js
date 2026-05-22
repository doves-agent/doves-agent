/**
 * @file app-templates
 * @description 白鸽应用脚手架模板生成 + 权限摘要格式化 + 交互式确认
 *
 * 从 app.js 拆分，KISS 原则
 */

import readline from 'readline';

// ==================== 交互式确认提示 ====================

/**
 * 交互式确认提示
 * @param {string} prompt
 * @returns {Promise<boolean>}
 */
export function askConfirm(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// ==================== 权限摘要格式化（CLI 本地实现，不依赖 Doves 代码） ====================

const URL_TYPE_LABELS = { connect: 'WebSocket连接', fetch: 'HTTP请求', iframe: '页面嵌入' };
const SCOPE_LABELS = { shared: '共享', user_scoped: '用户隔离', task_scoped: '任务隔离', extension: '扩展私有' };
const DB_ACTION_LABELS = {
  find: '查询', findOne: '单条查询', aggregate: '聚合',
  insertOne: '插入', insertMany: '批量插入',
  updateOne: '更新', updateMany: '批量更新',
  deleteOne: '删除', deleteMany: '批量删除',
  countDocuments: '计数', findOneAndUpdate: '查找并更新',
  findOneAndDelete: '查找并删除', index: '索引',
};

/**
 * 生成人类可读的权限摘要
 * 与 doves/extensions/_permissions.js 的 generatePermissionSummary 逻辑一致
 * CLI 侧本地实现，避免跨模块 import
 */
export function formatPermissionSummary(permissions) {
  if (!permissions || typeof permissions !== 'object') return '  （无权限声明）';
  const lines = [];

  if (permissions.databases && Object.keys(permissions.databases).length > 0) {
    lines.push('  数据库:');
    for (const [dbName, dbConfig] of Object.entries(permissions.databases)) {
      if (!dbConfig.collections) continue;
      for (const [collName, collConfig] of Object.entries(dbConfig.collections)) {
        const scope = collConfig.scope || 'shared';
        const actions = (collConfig.actions || []).map(a => DB_ACTION_LABELS[a] || a).join('/');
        lines.push(`    · ${dbName}.${collName}: ${actions}(${SCOPE_LABELS[scope] || scope})`);
      }
    }
  }

  if (permissions.storage && Object.keys(permissions.storage).length > 0) {
    lines.push('  存储:');
    for (const [storageType, typeConfig] of Object.entries(permissions.storage)) {
      const actions = (typeConfig.actions || []).join('/');
      lines.push(`    · ${storageType}: ${actions}`);
    }
  }

  if (permissions.apis && Object.keys(permissions.apis).length > 0) {
    lines.push('  API:');
    for (const [pattern, perm] of Object.entries(permissions.apis)) {
      const permLabel = Array.isArray(perm) ? perm.join('/') : perm;
      lines.push(`    · ${pattern}: ${permLabel}`);
    }
  }

  if (permissions.events) {
    lines.push('  事件:');
    if (permissions.events.subscribe) lines.push(`    · 订阅: ${permissions.events.subscribe.join(', ')}`);
    if (permissions.events.publish) lines.push(`    · 发布: ${permissions.events.publish.join(', ')}`);
  }

  if (permissions.extensions && Object.keys(permissions.extensions).length > 0) {
    lines.push('  扩展间通信:');
    for (const [extName, perm] of Object.entries(permissions.extensions)) {
      lines.push(`    · ${extName}: ${perm}`);
    }
  }

  if (permissions.externalUrls && permissions.externalUrls.length > 0) {
    lines.push('  外部链接:');
    for (const entry of permissions.externalUrls) {
      const typeLabel = URL_TYPE_LABELS[entry.type] || entry.type;
      const desc = entry.description ? `(${entry.description})` : '';
      lines.push(`    · ${entry.url}: ${typeLabel}${desc}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '  （无权限声明）';
}

// ==================== 脚手架模板生成函数 ====================

export function generateManifestTemplate(name, description) {
  return `/**
 * ${name} - 白鸽应用 manifest
 *
 * 详细文档: 白鸽文档/工具技能与应用.md
 */
export default {
  // === 基本信息 ===
  name: '${name}',
  version: '0.1.0',
  description: '${description}',
  abilities: [],  // 能力声明，如 ['数据分析', '报表生成']

  // === 依赖的其他应用（填 manifest.name） ===
  dependencies: [],

  // === 开发者信息（发布前必填） ===
  developer: {
    id: 'dev_',  // 开发者ID，以 dev_ 开头
  },

  // === LLM 层 ===
  intent: './intent.js',       // 意图定义
  strategy: './strategy.js',   // 规划策略
  roles: './roles.js',         // 角色定义
  // review: './review.js',    // 审核规则（可选）
  // execution: './execution.js', // 执行器增强（可选）

  // === 工具与技能 ===
  tools: './tools',     // 工具目录
  skills: './skills',   // 技能目录

  // === 权限声明（访问数据库/存储/API 等资源必须在此声明） ===
  permissions: {
    // databases: {
    //   '数据库名': {
    //     collections: {
    //       '集合名': {
    //         actions: ['find', 'findOne', 'insertOne', 'updateOne', 'deleteOne', 'index'],
    //         scope: 'user_scoped',  // shared / user_scoped / task_scoped / extension
    //         userField: 'user_id',  // user_scoped 时必填
    //       },
    //     },
    //   },
    // },
    // storage: {
    //   oss: { actions: ['read', 'write'] },
    //   'git-storage': { actions: ['read', 'write'] },
    //   memory: { actions: ['search', 'write'] },
    // },
    // apis: {
    //   'dove:config': 'read',
    // },
    // events: {
    //   subscribe: ['词汇学习.*'],
    //   publish: ['词汇学习.completed'],
    // },
  },

  // === Web 页面（可选） ===
  // web: {
  //   nav: { icon: '📦', label: '${name}' },
  //   pages: {
  //     'main': { title: '主页', entry: './web/index.html' },
  //   },
  // },

  // === 初始化钩子（可选，加载时执行） ===
  // async onInit(ctx) {
  //   // ctx 是 DoveAppContext，提供受控的数据库/存储/API 访问
  //   // 详见: 白鸽文档/工具技能与应用.md
  // },
};
`;
}

export function generateIntentTemplate(name) {
  return `/**
 * ${name} - 意图定义
 *
 * 定义该应用支持的意图类型及对应的执行模式
 * 详见: 白鸽文档/Doves鸽子框架.md #意图识别与路由
 */
export default {
  /**
   * 意图列表：每个意图定义了一个用户意图的识别规则
   */
  intents: [
    {
      name: '${name}_task',
      description: '${name} 相关任务',
      keywords: [],  // 触发关键词
      executionMode: 'direct',  // direct / decomposition_first / interleaved / pipeline / serial
    },
  ],

  /**
   * 意图识别提示词增强（可选）
   */
  promptEnhancement: '',
};
`;
}

export function generateStrategyTemplate() {
  return `/**
 * 规划策略
 *
 * 定义该应用的子任务拆分策略
 * 详见: 白鸽文档/Doves鸽子框架.md #规划器与审核器
 */
export default {
  /**
   * 子任务拆分策略提示词
   */
  strategies: {},

  /**
   * 默认策略名称
   */
  defaultStrategy: null,
};
`;
}

export function generateRolesTemplate() {
  return `/**
 * 角色定义
 *
 * 定义该应用专用的子任务角色及对应的系统提示词
 * 详见: 白鸽文档/Doves鸽子框架.md #子任务角色系统
 */
export default {
  /**
   * 有效的角色列表
   */
  validRoles: [],

  /**
   * 角色 → 系统提示词 映射
   */
  roles: {},
};
`;
}

export function generateReviewTemplate() {
  return `/**
 * 审核规则（可选）
 *
 * 定义该应用的特定审核规则，注册到审核器
 * 详见: 白鸽文档/Doves鸽子框架.md #审核器
 */
export default {
  /**
   * 审核规则列表
   */
  rules: [],
};
`;
}

export function generateExecutionTemplate() {
  return `/**
 * 执行器增强（可选）
 *
 * 增强 LLM 执行器的行为
 */
export default {
  /**
   * 在工具调用前执行（可选）
   */
  // async beforeToolCall(ctx, toolName, args) {},

  /**
   * 在工具调用后执行（可选）
   */
  // async afterToolCall(ctx, toolName, args, result) {},
};
`;
}

export function generateExampleToolTemplate(name) {
  return `/**
 * ${name} - 示例工具
 *
 * 工具是 LLM 可调用的函数，通过 Function Calling 触发
 * 详见: 白鸽文档/工具技能与应用.md #工具系统
 */

/**
 * 工具定义列表
 */
export const extTools = [
  {
    name: '${name}_hello',
    description: '示例工具 - 打招呼',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '要打招呼的名字',
        },
      },
      required: ['name'],
    },
  },
];

/**
 * 工具安全级别
 * safe / caution / dangerous
 */
export const extToolSafetyLevels = {
  ${name}_hello: 'safe',
};

/**
 * 工具处理函数
 * @param {string} toolName - 工具名
 * @param {Object} args - 工具参数
 * @param {Object} ctx - DoveAppContext（由框架注入）
 * @returns {Promise<*>} 工具执行结果
 */
export async function handleExtTool(toolName, args, ctx) {
  switch (toolName) {
    case '${name}_hello':
      return { message: \`你好，\${args.name}！这是 ${name} 应用的示例工具\` };
    default:
      throw new Error(\`未知工具: \${toolName}\`);
  }
}
`;
}

export function generateExampleSkillTemplate(name) {
  return `/**
 * ${name} - 示例技能
 *
 * 技能是更高层的封装，包含独立的能力声明和执行逻辑
 * 详见: 白鸽文档/工具技能与应用.md #技能系统
 */
export default {
  /**
   * 技能名称
   */
  name: '${name}_example',

  /**
   * 技能分类
   */
  category: '代码计算',

  /**
   * 能力声明（用于能力匹配）
   */
  abilities: ['${name}'],

  /**
   * 执行函数
   * @param {Object} params - 执行参数
   * @param {Object} ctx - DoveAppContext
   * @returns {Promise<*>}
   */
  async execute(params, ctx) {
    ctx.logger.info(\`执行技能: \${params}\`);
    return { result: \`${name} 技能执行成功\` };
  },
};
`;
}

export function generateReadmeTemplate(name, description) {
  return `# ${name}

> ${description}

## 目录结构

\`\`\`
${name}/
├── manifest.js       # 应用声明
├── intent.js         # 意图定义
├── strategy.js       # 规划策略
├── roles.js          # 角色定义
├── review.js         # 审核规则（可选）
├── execution.js      # 执行器增强（可选）
├── tools/            # 工具目录
├── skills/           # 技能目录
├── web/              # Web 页面（可选）
└── README.md
\`\`\`

## 开发

编辑 manifest.js 完善应用声明，开发 tools/ 和 skills/ 下的业务逻辑。

## 测试

\`\`\`bash
dove app validate ${name}    # 校验 manifest 完整性
dove app dev ${name}         # 沙盒测试
\`\`\`

## 发布

\`\`\`bash
dove app publish ${name}     # 编译并发布到仓库
\`\`\`
`;
}
