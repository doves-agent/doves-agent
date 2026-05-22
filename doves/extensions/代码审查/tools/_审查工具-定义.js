/**
 * @file 审查工具-定义.js
 * @description 审查工具定义、安全扫描模式、辅助函数，从 审查工具.js 抽取
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ==================== 工具定义 ====================

export const extTools = [
  {
    name: 'review_pr',
    description: '审查PR：获取分支diff，返回结构化审查数据供LLM多维度分析。',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: '基准分支（默认main）' },
        target: { type: 'string', description: '目标分支（必填）' },
        dimensions: { type: 'array', items: { type: 'string', enum: ['security', 'performance', 'style', 'maintainability'] }, description: '审查维度（默认全部）' },
        strictness: { type: 'string', enum: ['strict', 'normal', 'relaxed'], description: '严格程度（默认normal）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['target']
    }
  },
  {
    name: 'review_diff',
    description: '审查指定diff范围：分析代码变更并返回结构化审查数据。',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '起始ref（必填）' },
        to: { type: 'string', description: '结束ref（默认HEAD）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['from']
    }
  },
  {
    name: 'review_checkstyle',
    description: '检查代码规范：对照项目配置检查代码风格。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要检查的文件或目录路径（必填）' },
        rules: { type: 'object', description: '自定义规则覆盖（可选）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['path']
    }
  },
  {
    name: 'review_security',
    description: '安全扫描：检查注入攻击、XSS、硬编码密钥、权限漏洞等安全问题。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要扫描的文件或目录路径（必填）' },
        severity: { type: 'string', enum: ['all', 'high', 'medium'], description: '最低严重级别（默认all）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['path']
    }
  },
  {
    name: 'review_auto_fix',
    description: '自动修复：基于审查结果生成修复建议，供LLM通过code_edit应用。',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: '文件路径（必填）' },
        issues: { type: 'array', description: '要修复的问题列表', items: { type: 'object', properties: { type: { type: 'string' }, line: { type: 'number' }, message: { type: 'string' }, suggestion: { type: 'string' } }, required: ['type', 'message', 'suggestion'] } },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['file', 'issues']
    }
  },
  {
    name: 'quality_gate',
    description: '质量门禁：基于审查结果综合评分，判断通过/阻断。',
    inputSchema: {
      type: 'object',
      properties: {
        reviewResults: { type: 'array', description: '审查结果列表（各维度）', items: { type: 'object', properties: { dimension: { type: 'string' }, score: { type: 'number' }, issues: { type: 'number' }, criticalIssues: { type: 'number' } }, required: ['dimension', 'score'] } },
        passThreshold: { type: 'number', description: '通过阈值（默认80）' },
        blockOnCritical: { type: 'boolean', description: '有严重问题时阻断（默认true）' }
      },
      required: ['reviewResults']
    }
  },
  {
    name: 'review_complexity',
    description: '代码复杂度分析：计算圈复杂度、嵌套深度、函数长度、认知复杂度等指标。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要分析的文件或目录路径（必填）' },
        threshold: { type: 'object', description: '复杂度阈值配置（可选）', properties: { maxCyclomatic: { type: 'number' }, maxNesting: { type: 'number' }, maxFunctionLength: { type: 'number' }, maxCognitive: { type: 'number' } } },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['path']
    }
  },
  {
    name: 'review_dependencies',
    description: '依赖安全审查：检查package.json中的已知漏洞依赖、过期依赖、许可证合规。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'package.json所在目录（默认当前目录）' },
        auditLevel: { type: 'string', enum: ['low', 'moderate', 'high', 'critical'], description: '最低报告级别（默认low）' },
        checkLicenses: { type: 'boolean', description: '是否检查许可证合规（默认true）' },
        cwd: { type: 'string', description: '工作目录' }
      }
    }
  },
  {
    name: 'review_history',
    description: '审查历史分析：分析历史审查模式，发现重复出现的问题模式和常见缺陷区域。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '仓库路径（默认当前目录）' },
        since: { type: 'string', description: '分析起始时间（如 "30 days ago"，默认30天）' },
        topN: { type: 'number', description: '返回Top N高频问题（默认10）' },
        cwd: { type: 'string', description: '工作目录' }
      }
    }
  }
];

// ==================== 工具分类/映射/安全分级 ====================

export const extToolCategories = {
  '审查工具': ['review_pr', 'review_diff', 'review_checkstyle', 'review_security', 'review_auto_fix', 'quality_gate', 'review_complexity', 'review_dependencies', 'review_history'],
};

export const extToolAbilityMap = {
  review_pr: ['代码审查', '安全审查', '质量门禁'],
  review_diff: ['代码审查'],
  review_checkstyle: ['代码审查', '质量门禁'],
  review_security: ['代码审查', '安全审查'],
  review_auto_fix: ['代码审查'],
  quality_gate: ['质量门禁'],
  review_complexity: ['代码审查', '质量门禁'],
  review_dependencies: ['代码审查', '安全审查'],
  review_history: ['代码审查'],
};

export const extToolSafetyLevels = {
  review_pr: '安全',
  review_diff: '安全',
  review_checkstyle: '安全',
  review_security: '安全',
  review_auto_fix: '谨慎',
  quality_gate: '安全',
  review_complexity: '安全',
  review_dependencies: '安全',
  review_history: '安全',
};

// ==================== 安全扫描模式 ====================

export const SECURITY_PATTERNS = [
  { name: '硬编码密码', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]+['"]/gi, severity: 'high' },
  { name: '硬编码API密钥', pattern: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"][^'"]+['"]/gi, severity: 'high' },
  { name: '硬编码Token', pattern: /(?:token|auth[_-]?token|access[_-]?token)\s*[:=]\s*['"][^'"]+['"]/gi, severity: 'high' },
  { name: 'SQL注入风险', pattern: /(?:query|execute|raw)\s*\(\s*['"].*\$\{.*\}.*['"]/gi, severity: 'high' },
  { name: 'XSS风险', pattern: /innerHTML\s*=|document\.write\s*\(/gi, severity: 'medium' },
  { name: 'eval使用', pattern: /\beval\s*\(/gi, severity: 'high' },
  { name: '不安全的正则', pattern: /new RegExp\s*\(\s*[^'"]*\+/gi, severity: 'medium' },
  { name: '不安全的文件操作', pattern: /(?:readFile|writeFile)\s*\(\s*[^,]*\+/gi, severity: 'medium' },
  { name: '控制台日志遗留', pattern: /console\.(log|debug|info|warn|error)\s*\(/gi, severity: 'low' },
  { name: 'TODO/FIXME标记', pattern: /(?:TODO|FIXME|HACK|XXX)\b/gi, severity: 'low' },
];

// ==================== 辅助函数 ====================

export const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

export async function runGit(args, cwd) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    throw new Error(`git ${args.join(' ')} 失败: ${e.message}`);
  }
}

export function 扫描安全内容(content, filePath, minSeverity = 'all') {
  const severityOrder = { low: 1, medium: 2, high: 3 };
  const minLevel = severityOrder[minSeverity] || 0;
  const findings = [];

  const lines = content.split('\n');
  for (const pattern of SECURITY_PATTERNS) {
    if (severityOrder[pattern.severity] < minLevel) continue;
    for (let i = 0; i < lines.length; i++) {
      pattern.pattern.lastIndex = 0;
      if (pattern.pattern.test(lines[i])) {
        findings.push({ type: pattern.name, severity: pattern.severity, file: filePath, line: i + 1, content: lines[i].trim().substring(0, 200), suggestion: getSecuritySuggestion(pattern.name) });
      }
    }
  }
  return findings;
}

export function getSecuritySuggestion(issueName) {
  const suggestions = {
    '硬编码密码': '使用环境变量或密钥管理服务存储密码',
    '硬编码API密钥': '使用环境变量或配置文件管理API密钥，不要提交到版本控制',
    '硬编码Token': '使用环境变量管理Token，确保不硬编码在源码中',
    'SQL注入风险': '使用参数化查询替代字符串拼接SQL',
    'XSS风险': '使用textContent替代innerHTML，或对输入进行HTML转义',
    'eval使用': '避免使用eval，考虑更安全的替代方案',
    '不安全的正则': '避免用用户输入构造正则表达式，可能导致ReDoS攻击',
    '不安全的文件操作': '验证和清理文件路径，防止路径遍历攻击',
    '控制台日志遗留': '生产环境应移除调试日志，使用日志框架替代',
    'TODO/FIXME标记': '标记需要后续处理的问题，确保不被遗忘',
  };
  return suggestions[issueName] || '请检查并修复此问题';
}
