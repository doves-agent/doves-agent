/**
 * @file tools/语义搜索
 * @description 增强的代码语义搜索工具
 * 
 * 双层语义增强：
 *   第一层（本地离线）：关键词-能力映射表，自动扩展等价术语
 *   第二层（可选云端）：AI 嵌入向量语义检索，通过Git记忆
 * 
 * 注册工具：
 *   - code_semantic_search  : 语义代码搜索（增强版）
 * 
 * 导出格式（兼容扩展加载器）：
 *   extTools / handleExtTool / extToolCategories / extToolAbilityMap / extToolSafetyLevels
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

// ==============================
// 关键词-能力映射表（本地离线）
// ==============================

/**
 * 技术术语语义等价映射表
 * 按领域分类，每个术语映射到同义/相关的查询词列表
 * 
 * 设计原则：
 * - 覆盖主流开发场景（Web/数据库/认证/部署/测试等）
 * - 包含中英文、缩写、全称
 * - 避免过度扩展（不包含过于宽泛的词）
 */
const SEMANTIC_MAP = {
  // ---- 认证与安全 ----
  'auth': ['authentication', '认证', '鉴权', 'authorization', '授权', 'login', '登录', 'token', 'jwt', 'session', '会话', '权限', 'permission', 'role', '角色', '密码', 'password', '加密', 'encrypt', 'decrypt', 'hash'],
  'authentication': ['auth', '认证', '鉴权', 'login', '登录', 'token', 'jwt'],
  'authorization': ['auth', '授权', 'permission', '权限', 'role', '角色', 'access', '访问控制', 'rbac'],
  'permission': ['auth', '授权', '权限', 'access', 'role', '角色'],
  'password': ['密码', 'pwd', 'passwd', 'credential', '凭证'],
  'token': ['auth', 'jwt', '令牌', '凭证', 'credential', 'bearer'],
  'jwt': ['auth', 'token', 'json web token', 'session'],
  'encrypt': ['加密', 'decrypt', '解密', 'cipher', '密码', 'crypto'],
  'oauth': ['auth', '授权', '第三方登录', 'social login', 'sso'],

  // ---- 数据库 ----
  'db': ['database', '数据库', 'mongodb', 'mongo', 'mysql', 'postgresql', 'sql', 'repository', 'data source', '数据源', '存储', 'storage', 'redis', 'cache', '缓存'],
  'database': ['db', '数据库', 'mongodb', 'mysql', '数据', 'data', '存储'],
  'mongodb': ['mongo', 'db', '数据库', 'nosql', '文档数据库'],
  'sql': ['query', '查询', '数据库', 'db', 'mysql', 'postgresql', '结构化查询'],
  'cache': ['缓存', 'redis', 'memcached', '缓冲', 'cache', 'ttl'],
  'redis': ['cache', '缓存', 'nosql', 'kv存储', 'key-value'],
  'migration': ['迁移', 'schema change', '数据库变更', 'db change', 'alter'],
  'orm': ['sequelize', 'typeorm', 'prisma', 'mongoose', '数据库映射', '对象关系映射', 'odm'],
  'repository': ['repo', 'db', '数据层', 'data access', 'dao', '仓储'],
  'query': ['查询', 'sql', '搜索', 'search', 'find', 'fetch', '获取'],

  // ---- 网络与通信 ----
  'api': ['接口', 'endpoint', 'rest', 'restful', '路由', 'route', 'http', 'service', '服务', 'web service'],
  'rest': ['restful', 'api', 'http', '接口', 'endpoint', 'web service'],
  'rpc': ['grpc', 'remote procedure call', '远程调用', 'protobuf', '服务间通信'],
  'graphql': ['gql', 'query language', 'apollo', 'relay', 'schema', 'resolver'],
  'websocket': ['ws', '长连接', '实时通信', 'realtime', 'socket', '推送', 'push'],
  'http': ['rest', 'api', '网络请求', 'request', 'response', 'fetch', 'axios', '请求'],
  'middleware': ['中间件', '拦截器', 'interceptor', 'filter', 'pipe', '管道', 'plugin', '插件'],
  'webhook': ['回调', 'callback', '通知', '通知回调', 'event notification'],

  // ---- 代码与编程 ----
  'refactor': ['重构', '重写', 'rewrite', '优化', '改进', 'improve', '优化', 'restructure', 'redesign'],
  'bugfix': ['bug', '修复', 'fix', '错误', 'error', 'defect', '缺陷', 'hotfix', '补丁', 'patch'],
  'debug': ['调试', 'bug', '修复', '错误排查', 'log', '日志', '断点', 'breakpoint', 'trace', '追踪'],
  'error': ['错误', '异常', 'exception', 'bug', '出错', 'failure', '失败', '崩溃', 'crash'],
  'exception': ['error', '异常', '错误', 'throw', '捕获', 'catch', 'try', '错误处理'],
  'validation': ['验证', '校验', 'validate', 'check', '检查', 'sanitize', '净化'],
  'config': ['配置', 'configuration', 'setting', '选项', 'option', '环境变量', 'env', 'environment'],
  'constant': ['常量', 'const', 'enum', '枚举', '不可变', 'immutable', '魔法数字', 'magic number'],
  'deprecated': ['废弃', '过时', '弃用', '不再维护', 'obsolete', 'removed', '删除'],
  'compatibility': ['兼容', '兼容性', 'migration', '迁移', '升级', 'upgrade', '版本迁移'],

  // ---- 测试 ----
  'test': ['测试', 'spec', 'unit test', '单测', '集成测试', 'integration', 'e2e', '端到端', 'jest', 'mocha', 'vitest', '验证', 'verify', 'assert', '断言'],
  'unittest': ['unit test', '单测', 'test', 'jest', 'mocha', 'vitest', 'junit'],
  'integration test': ['集成测试', 'e2e', '端到端', 'test', '测试', '端到端测试'],
  'mock': ['模拟', 'stub', '桩', 'fake', '假数据', '测试替身', 'test double', 'vi.mock', 'jest.mock'],
  'benchmark': ['性能测试', 'bench', '压测', 'performance', '性能', '压力测试', 'load test', '耗时'],
  'ci': ['持续集成', 'continuous integration', 'github actions', 'gitlab ci', 'jenkins', '自动化构建', 'build', '构建'],

  // ---- UI/前端 ----
  'ui': ['用户界面', 'interface', '组件', 'component', 'view', '视图', 'page', '页面', '前端', 'frontend'],
  'component': ['组件', 'ui', 'widget', '控件', 'element', '元素', 'react component', 'vue component'],
  'state': ['状态', 'store', 'redux', 'vuex', 'pinia', '状态管理', 'context', '全局状态', 'setState', 'usestate'],
  'responsive': ['响应式', '自适应', 'rwd', 'mobile', '移动端', '适配', '兼容'],
  'animation': ['动画', 'transition', '过渡', 'transform', '变换', 'motion', '动效'],
  'i18n': ['国际化', 'internationalization', '多语言', '本地化', 'localization', 'l10n', '翻译', 'translate'],
  'theme': ['主题', '样式', 'style', '配色', 'color', '皮肤', 'skin', '暗黑模式', 'dark mode', 'light mode'],

  // ---- 后端 ----
  'mvc': ['model-view-controller', 'controller', '控制器', 'model', '模型', 'service', '服务层', '视图', 'view'],
  'controller': ['路由', 'route', 'handler', '处理函数', 'mvc', 'endpoint', 'api'],
  'service': ['服务', '业务逻辑', 'business logic', 'service layer', '服务层', 'application service'],
  'scheduler': ['定时任务', 'cron', '定时', 'job', '计划任务', 'interval', '轮询', 'polling', '事件调度'],
  'queue': ['消息队列', 'mq', 'rabbitmq', 'kafka', 'bull', '任务队列', 'task', 'job', '消息'],
  'event': ['事件', '消息', 'message', 'emit', '触发', 'trigger', 'listener', '监听', '订阅', 'subscribe', '发布', 'publish', 'event emitter', '事件驱动'],
  'worker': ['worker', '消费者', 'consumer', '后台任务', 'background', 'job', '任务', 'thread', '线程'],
  'cron': ['定时任务', 'scheduler', 'schedule', 'job', '定时', '周期任务', 'interval'],

  // ---- 容器与部署 ----
  'docker': ['container', '容器', 'dockerfile', 'image', '镜像', 'compose', 'docker-compose', 'docker compose'],
  'kubernetes': ['k8s', '容器编排', 'pod', 'service', 'deployment', 'cluster', '集群', '微服务'],
  'deploy': ['部署', 'release', '发布', '上线', 'production', '生产', 'publish', 'rollout', '交付'],
  'devops': ['devops', 'ci/cd', '运维', '部署', '自动化运维', 'sre', '平台工程'],
  'monitor': ['监控', 'monitoring', '告警', 'alert', '日志', 'log', 'metrics', '指标', 'grafana', 'prometheus', '可视化'],
  'logging': ['log', '日志', '记录', 'logger', 'console', '输出', 'log4j', 'winston', '追踪', 'trace'],
  'backup': ['备份', '恢复', 'restore', '快照', 'snapshot', '灾备', 'disaster recovery'],

  // ---- 架构与设计 ----
  'pattern': ['设计模式', 'design pattern', '架构', 'architecture', 'singleton', '工厂', 'factory', 'observer', '观察者', '策略', 'strategy'],
  'singleton': ['单例', '单例模式', 'single instance', '全局', 'global'],
  'factory': ['工厂', 'factory pattern', '创建', 'create', 'builder', '构建'],
  'observer': ['观察者', 'event', '事件', 'publish-subscribe', '发布订阅', 'listener', '监听'],
  'proxy': ['代理', '代理模式', 'forward', '代理服务器', 'gateway', '网关', '反向代理', 'reverse proxy'],
  'dependency injection': ['di', '依赖注入', 'ioc', '控制反转', 'inversion of control', '注入', 'inject'],
  'aop': ['面向切面', 'aspect', '横切', 'cross-cutting', 'interceptor', '拦截器', '切面'],
  'microservice': ['微服务', 'service mesh', '分布式', 'distributed', '服务治理'],

  // ---- 性能 ----
  'performance': ['性能', '优化', 'optimization', '速度', 'speed', '延迟', 'latency', '吞吐', 'throughput', 'qps', 'tps', '响应时间', 'response time', '慢', 'slow', '瓶颈', 'bottleneck'],
  'optimization': ['优化', '性能', 'improve', '改进', '加速', 'speed up', '效率', 'efficiency'],
  'concurrency': ['并发', 'parallel', '并行', '多线程', 'multithread', '异步', 'async', 'goroutine', '协程'],
  'async': ['异步', '非阻塞', 'non-blocking', 'await', 'promise', 'future', '回调', 'callback', '事件循环', 'event loop', '协程'],
  'throttle': ['节流', '限流', 'rate limit', 'debounce', '防抖', '频率控制', '流量控制'],
  'pool': ['连接池', 'pool', 'connection pool', '复用', 'reuse', '缓冲池'],
  'lazy': ['懒加载', 'lazy loading', '延迟加载', 'deferred', '按需加载', 'on-demand'],
  'memoize': ['记忆化', '缓存', 'cache', 'memoization', '结果缓存', '计算缓存'],
};

// ==============================
// 语义搜索器
// ==============================

class SemanticSearchEngine {
  constructor() {
    this._semanticMap = SEMANTIC_MAP;
    this._gitMemory = null; // Git记忆引用（按需初始化）
  }

  /**
   * 设置Git记忆引用（用于第二层 AI 嵌入检索）
   */
  setGitMemory(memoryRef) {
    this._gitMemory = memoryRef;
  }

  /**
   * 获取查询的关键词扩展
   */
  expandQuery(query) {
    const lower = query.toLowerCase();
    const expansions = new Set([query, lower]);

    // 精确匹配
    if (this._semanticMap[lower]) {
      for (const word of this._semanticMap[lower]) {
        expansions.add(word);
      }
    }

    // 部分匹配：检查 query 中的单词是否在映射表中
    const words = lower.split(/[\s_-]+/);
    for (const word of words) {
      if (this._semanticMap[word]) {
        for (const syn of this._semanticMap[word]) {
          expansions.add(syn);
        }
      }
    }

    // 中英混合支持：如果包含中文，也尝试英文同义
    if (/[\u4e00-\u9fff]/.test(query)) {
      for (const [key, vals] of Object.entries(this._semanticMap)) {
        if (vals.some(v => query.includes(v))) {
          expansions.add(key);
          for (const v of vals) {
            if (!v.includes(query)) expansions.add(v);
          }
        }
      }
    }

    return Array.from(expansions).filter(Boolean).slice(0, 30);
  }

  /**
   * 第一层：本地关键词搜索
   * 使用扩展后的关键词列表进行多轮正则搜索
   */
  async localSearch(query, options = {}) {
    const { searchPath = process.cwd(), maxResults = 50, glob = null, contextLines = 2 } = options;
    const expanded = this.expandQuery(query);

    // 将扩展的关键词转为正则
    const regexPatterns = expanded
      .filter(w => w.length >= 2) // 忽略单字符
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // 转义
      .filter(w => w.length <= 100); // 避免过长的模式

    // 分批搜索，避免性能问题
    const matches = [];
    const seenKeys = new Set();

    // 使用展开的关键词生成多个正则，在文件内容中搜索
    for (const pattern of regexPatterns) {
      if (matches.length >= maxResults) break;
      if (seenKeys.has(pattern.toLowerCase())) continue;
      seenKeys.add(pattern.toLowerCase());

      try {
        const regex = new RegExp(pattern.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i');
        // 这里我们返回扩展信息，实际的搜索由调用者执行
        matches.push({
          keyword: pattern,
          regexSource: regex.source,
          expandedFrom: query,
        });
      } catch {
        // 忽略无效正则
      }
    }

    return {
      query,
      expandedTerms: expanded.filter(w => w !== query),
      matchPatterns: regexPatterns.slice(0, 20),
      totalExpansions: expanded.length,
    };
  }

  /**
   * 第二层：AI 嵌入语义检索（通过Git记忆）
   */
  async aiSearch(query, options = {}) {
    const { projectRoot = process.cwd(), maxResults = 20 } = options;

    if (!this._gitMemory) {
      return { available: false, reason: 'Git记忆未配置，AI 语义检索不可用' };
    }

    try {
      const results = await this._gitMemory.search(query, {
        namespace: 'code-semantic',
        limit: maxResults,
        filter: { projectRoot },
      });

      return {
        available: true,
        results: results.map(r => ({
          filePath: r.metadata?.filePath || '',
          snippet: r.content || '',
          score: r.score || 0,
          line: r.metadata?.line || 0,
        })),
      };
    } catch (e) {
      return { available: false, reason: `AI 检索失败: ${e.message}` };
    }
  }
}

// ==============================
// 全局语义搜索引擎单例
// ==============================
const semanticEngine = new SemanticSearchEngine();

/**
 * 设置Git记忆引用（供外部调用）
 */
export function setGitMemory(memoryRef) {
  semanticEngine.setGitMemory(memoryRef);
}

/**
 * 获取关键词扩展信息（供其他工具使用）
 */
export function expandKeywords(query) {
  return semanticEngine.expandQuery(query);
}

// ==============================
// 工具定义
// ==============================

export const extTools = [
  {
    name: 'code_semantic_search',
    description: '语义代码搜索（模糊搜索），与 code_search 有区别！code_search=精确正则（知道确切关键词时用）；code_semantic_search=语义模糊搜索（不确定关键词或想搜同义词时用）。自动扩展同义词/相关术语，例如搜索"auth"会自动搜索authentication/认证/鉴权/token/jwt等。支持双层机制：本地关键词映射 + AI嵌入检索（可选）。适合场景：不确定确切命名方式时搜索、找相关的代码片段、跨语言搜索同一概念。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（必填），支持中英文混合，例如 "用户登录"、"auth"、"数据库连接池"' },
        path: { type: 'string', description: '搜索目录（默认当前工作目录）' },
        mode: { type: 'string', enum: ['auto', 'local', 'ai'], description: '搜索模式（默认auto：优先尝试AI，AI不可用时仅用本地映射）' },
        max_results: { type: 'number', description: '最大结果数（默认50）' },
        glob: { type: 'string', description: '文件类型过滤，如 "*.js" 或 "*.{ts,tsx}"（可选）' },
        context_lines: { type: 'number', description: '上下文行数（默认2）' },
      },
      required: ['query']
    }
  },
  {
    name: 'code_keyword_expand',
    description: '查看某关键词的语义扩展结果，不执行实际搜索。可用于调试语义映射表或了解哪些术语会被扩展搜索。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要扩展的关键词（必填）' },
      },
      required: ['query']
    }
  },
];

// ==============================
// 字符串搜索工具函数（独立内联实现，避免循环引用）
// ==============================

const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'release', '.cache', '__pycache__', '.next', '.nuxt'];

function isExcludedDir(name) {
  return EXCLUDED_DIRS.includes(name);
}

function matchGlob(filePath, pattern) {
  const regexStr = pattern
    .split('**').map(s => s.split('*').map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('[^/\\\\]*')).join('.*');
  return new RegExp('^' + regexStr + '$', 'i').test(filePath.replace(/\\/g, '/'));
}

async function searchInDirectory(dirPath, regex, options = {}) {
  const { contextLines = 2, maxResults = 50, glob = null, results = [] } = options;
  if (results.length >= maxResults) return results;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch { return results; }

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (isExcludedDir(entry.name)) continue;
    const fullPath = resolve(dirPath, entry.name);

    if (entry.isDirectory()) {
      await searchInDirectory(fullPath, regex, { contextLines, maxResults, glob, results });
    } else if (entry.isFile()) {
      if (glob && !matchGlob(fullPath, glob)) continue;
      let stat;
      try { stat = await fs.stat(fullPath); } catch { continue; }
      if (stat.size > 1024 * 1024) continue;
      let content;
      try { content = await fs.readFile(fullPath, 'utf-8'); } catch { continue; }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        if (regex.test(lines[i])) {
          results.push({
            file: fullPath,
            line: i + 1,
            content: lines[i].substring(0, 200),
            context_before: lines.slice(Math.max(0, i - contextLines), i),
            context_after: lines.slice(i + 1, i + 1 + contextLines),
          });
        }
      }
    }
  }
  return results;
}

// ==============================
// 工具调用处理器
// ==============================

const text = (obj) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }]
});

const error = (msg) => text({ error: msg });

export async function handleExtTool(name, args) {
  try {
    switch (name) {

      // ===== 1. 语义搜索 =====
      case 'code_semantic_search': {
        const { query, path: searchPath, mode = 'auto', max_results = 50, glob = null, context_lines = 2 } = args;

        if (!query || query.trim().length === 0) {
          return error('缺少必填参数: query');
        }

        // 1. 获取关键词扩展信息
        const expansion = await semanticEngine.localSearch(query, { maxResults });
        
        // 2. 使用扩展后的模式执行搜索
        const regexPatterns = expansion.matchPatterns;
        if (regexPatterns.length === 0) {
          return text({
            tool: 'code_semantic_search',
            query,
            mode: 'local',
            expandedTerms: [],
            total_matches: 0,
            matches: [],
            message: '未找到可扩展的搜索词',
          });
        }

        // 合并所有扩展词为一个正则（OR 匹配）
        const combinedPattern = regexPatterns.map(p => `(${p})`).join('|');
        let combinedRegex;
        try {
          combinedRegex = new RegExp(combinedPattern, 'i');
        } catch {
          return error(`无法编译搜索正则，扩展词过多`);
        }

        const searchPathResolved = resolve(searchPath || process.cwd());
        const matches = await searchInDirectory(searchPathResolved, combinedRegex, {
          contextLines: context_lines,
          maxResults,
          glob,
        });

        // 3. 如果 mode=ai 或 mode=auto，尝试 AI 检索
        let aiResults = null;
        if (mode === 'ai' || mode === 'auto') {
          aiResults = await semanticEngine.aiSearch(query, {
            projectRoot: searchPathResolved,
            maxResults,
          });
          // auto 模式下 AI 不可用时仅用本地结果
          if (mode === 'auto' && aiResults && !aiResults.available) {
            aiResults = null;
          }
        }

        return text({
          tool: 'code_semantic_search',
          query,
          mode: mode || 'auto',
          expandedTerms: expansion.expandedTerms.slice(0, 15),
          totalPatterns: regexPatterns.length,
          total_matches: matches.length,
          matches,
          aiResults: aiResults?.available ? {
            total: aiResults.results.length,
            results: aiResults.results,
          } : undefined,
          _note: regexPatterns.length > 1 ? `搜索已自动扩展为 ${regexPatterns.length} 个同义/相关模式` : undefined,
        });
      }

      // ===== 2. 关键词扩展调试 =====
      case 'code_keyword_expand': {
        const { query } = args;
        if (!query) return error('缺少必填参数: query');

        const terms = semanticEngine.expandQuery(query);
        
        // 按领域分组
        const grouped = {};
        for (const [key, vals] of Object.entries(SEMANTIC_MAP)) {
          if (query.toLowerCase().includes(key) || vals.some(v => query.toLowerCase().includes(v.toLowerCase()))) {
            grouped[key] = vals;
          }
        }

        const matchedKeys = Object.keys(grouped);

        return text({
          tool: 'code_keyword_expand',
          query,
          expandedTerms: terms.filter(t => t !== query).slice(0, 30),
          totalExpansions: terms.length,
          matchedSemanticKeys: matchedKeys.slice(0, 10),
          matchedSemanticCount: matchedKeys.length,
          _tip: matchedKeys.length > 0
            ? `命中 ${matchedKeys.length} 个语义映射组，共扩展为 ${terms.length} 个相关词`
            : `${query} 未找到语义映射，仅作为关键词精确匹配`,
        });
      }

      default:
        return null; /* 不处理此工具，交给链中下一个处理器 */
    }
  } catch (e) {
    return error(`[${name}] ${e.message}`);
  }
}

// ==============================
// 工具分类
// ==============================

export const extToolCategories = {
  代码工具: ['code_semantic_search', 'code_keyword_expand'],
};

// ==============================
// 工具能力映射
// ==============================

export const extToolAbilityMap = {
  code_semantic_search: ['编程', '代码', '搜索', '语义', '分析'],
  code_keyword_expand: ['编程', '代码', '搜索', '语义', '工具'],
};

// ==============================
// 工具安全分级
// ==============================

export const extToolSafetyLevels = {
  code_semantic_search: '安全',
  code_keyword_expand: '安全',
};

// ==============================
// 默认导出
// ==============================
export default {
  extTools,
  handleExtTool,
  extToolCategories,
  extToolAbilityMap,
  extToolSafetyLevels,
  setGitMemory,
  expandKeywords,
};
