/**
 * Git版本管理规划策略
 * git_analysis: Git仓库分析策略
 * git_operation: Git操作策略
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

// ==================== Git分析策略 ====================

const 分析方法论段落 = [
  '【Git仓库分析能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. Git操作工具',
  '   Git操作：仓库基本操作（status/log/branch/fetch/pull/stash等）',
  '',
  '2. Git差异工具',
  '   Git差异：分析提交变更内容（diff/统计）',
  '',
  '3. Git溯源工具',
  '   Git溯源：追溯代码修改历史（blame）',
  '',
  '4. Git统计工具',
  '   Git统计：仓库级别统计信息',
  '',
  '5. Git对比工具',
  '   Git对比：对比分支差异',
  '',
  '6. Git文件历史工具',
  '   Git文件历史：追踪文件演变过程',
  '',
  '7. Git搜索工具',
  '   Git搜索：搜索提交记录',
  '',
  '8. git_analysis 技能',
  '   语义分析能力：提交分类、变更影响分析、代码审查建议、changelog生成、文档完整性检查',
  '',
  '【流程案例】（参考，非强制）',
  '- 仓库健康检查：Git操作(status) → Git操作(log) → Git统计 → git_analysis(提交分类)',
  '- 提交深度分析：Git操作(log) → Git差异(变更详情) → Git溯源(责任追溯) → git_analysis(审查建议)',
  '- 分支差异对比：Git对比(分支对比) → Git差异(具体变更) → git_analysis(影响评估)',
  '- 变更日志生成：Git操作(log) → git_analysis(changelog)',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 分析优先使用结构化Git工具，避免使用 执行命令 直接执行 git 命令',
  '- 多步分析时先收集数据再做深度分析',
].join('\n');

const 分析输出格式扩展 = `"gitContext": {
    "repoPath": "仓库路径",
    "analysisScope": "commit|range|branch|repo",
    "riskLevel": "low|medium|high"
  },`;

const 分析方法论指引 = '请根据用户实际需求，从Git仓库分析能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。分析优先使用结构化Git工具，避免直接执行git命令。';

// ==================== Git操作策略 ====================

const 操作方法论段落 = [
  '【Git操作能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 基础操作工具',
  '   git_commit：提交代码（支持Conventional Commits规范）',
  '   git_push：推送远程',
  '   git_pull / git_fetch：拉取更新',
  '   git_checkout：切换分支/恢复文件',
  '   git_stash：暂存/恢复工作区',
  '',
  '2. 分支合并工具',
  '   git_merge：合并分支（危险，需确认）',
  '   git_rebase：变基（危险，需确认）',
  '   git_cherry_pick：摘取提交（可能产生冲突）',
  '',
  '3. 回退工具',
  '   git_revert：安全回退，创建新提交（推荐）',
  '   git_reset：强制回退（危险，强制快照）',
  '',
  '4. 冲突解决工具',
  '   git_conflict_resolve：冲突检测与处理',
  '   conflict_resolver 技能：analyze/auto_merge/batch_resolve/resolve',
  '',
  '5. PR管理工具',
  '   pr_manager 技能：generate_description/review_submit/merge_pr/status_track/template_generate',
  '   git_pr_create：创建Pull Request',
  '',
  '6. 辅助工具',
  '   git_tag：标签管理（create/list/delete/show）',
  '   git_bisect：Bug定位（start/good/bad/run/reset）',
  '   git_worktree：工作树管理（add/list/remove/prune）',
  '   git_reflog：恢复丢失提交',
  '',
  '【流程案例】（参考，非强制）',
  '- 提交代码：Git操作(status确认) → git_commit → git_push',
  '- 合并分支：git_fetch → git_merge（操作前快照）→ Git操作(log验证)',
  '- 解决冲突：git_conflict_resolve → conflict_resolver(analyze) → git_commit',
  '- 创建PR：pr_manager(generate_description) → git_pr_create → pr_manager(status_track)',
  '- 安全回退：git_revert（不修改历史，推荐）',
  '- 恢复丢失提交：git_reflog(show) → git_checkout',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 危险操作（push/merge/rebase/reset）前必须创建Git存储磁盘快照',
  '- revert比reset更安全（不修改历史），优先推荐',
  '- cherry-pick可能产生冲突，需配合冲突解决工具',
  '- 使用结构化Git工具而非 执行命令',
].join('\n');

const 操作输出格式扩展 = `"gitOperation": {
    "operationType": "commit|push|merge|rebase|reset|revert|conflict_resolve|pr_create|cherry_pick|tag|bisect|worktree|reflog",
    "targetBranch": "目标分支",
    "safetySnapshotCreated": true
  },`;

const 操作方法论指引 = '请根据用户实际需求，从Git操作能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。危险操作前必须创建快照，优先使用结构化Git工具。';

// ==================== 导出 ====================

export default {
  strategies: {
    git_analysis: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        'Git仓库分析',
        分析方法论段落,
        分析输出格式扩展,
        最大子任务数,
        当前深度
      ),

      用户: (任务描述, 能力列表, 可用技能 = []) => 生成用户提示词(
        任务描述,
        能力列表,
        可用技能,
        分析方法论指引
      ),
    },

    git_operation: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        'Git操作',
        操作方法论段落,
        操作输出格式扩展,
        最大子任务数,
        当前深度
      ),

      用户: (任务描述, 能力列表, 可用技能 = []) => 生成用户提示词(
        任务描述,
        能力列表,
        可用技能,
        操作方法论指引
      ),
    },
  },
};
