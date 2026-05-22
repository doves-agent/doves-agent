/**
 * 代码审查规划策略
 * 代码审查能力组 + 流程案例
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【代码审查能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 变更收集工具',
  '   code_git_diff_detail / code_git_compare：获取分支diff',
  '   code_git_blame：追溯关键代码修改历史',
  '   code_git_stats：仓库级别变更频率',
  '',
  '2. 审查工具',
  '   review_pr：PR审查',
  '   review_diff：Diff审查',
  '   review_security：安全扫描（注入攻击/XSS/硬编码密钥/权限漏洞）',
  '   review_checkstyle：规范检查（对照项目配置的编码规范）',
  '   review_auto_fix：生成自动修复建议',
  '   review_complexity：复杂度分析',
  '   review_dependencies：依赖安全审查',
  '   review_history：历史模式分析',
  '',
  '3. 质量门禁工具',
  '   quality_gate 工具 + 技能：综合各维度得分，决定通过/阻断',
  '   严重问题（安全漏洞）→ 阻断，中等问题（规范违反）→ 警告',
  '',
  '4. PR审查技能',
  '   pr_review 技能：review/full_diff/batch_review/preference_learn',
  '',
  '【流程案例】（参考，非强制）',
  '- PR审查：review_pr → review_security(安全) → review_checkstyle(规范) → quality_gate(门禁)',
  '- Diff审查：code_git_diff_detail(获取diff) → review_diff(审查) → review_auto_fix(修复建议)',
  '- 安全专项：review_security(安全扫描) → review_auto_fix(修复建议)',
  '- 全面审查：review_pr → review_security → review_checkstyle → review_complexity → review_dependencies → quality_gate',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 安全漏洞为严重问题，应阻断',
  '- 每个发现的问题应附带修复方案',
  '- 审查偏好可沉淀到Git记忆',
].join('\n');

const 输出格式扩展 = '"reviewContext": {\n    "reviewScope": "pr|diff|branch|repo",\n    "dimensions": ["security", "performance", "style", "maintainability"],\n    "strictness": "strict|normal|relaxed"\n  },';

const 方法论指引 = '请根据用户实际需求，从代码审查能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。使用 review_* 工具、pr_review 技能和 quality_gate 技能。';

export default {
  strategies: {
    code_review: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        '代码审查',
        方法论段落,
        输出格式扩展,
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
