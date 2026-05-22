/**
 * Git版本管理意图定义
 * 包含 git_repo（仓库管理）、git_analysis（仓库分析）和 git_operation（Git操作）三个意图
 */
export default {
  intents: {
    GIT_REPO: 'git_repo',
    GIT_ANALYSIS: 'git_analysis',
    GIT_OPERATION: 'git_operation',
  },

  executionModeMap: {
    git_repo: '直接执行',
    git_analysis: '先规划后执行',
    git_operation: '先规划后执行',
  },

  intentKeywords: {
    git_repo: ['管理仓库', '添加仓库', '仓库列表', '切换仓库', '删除仓库', '克隆仓库', 'clone', '操作历史', '仓库配置', '指定仓库', '打开仓库'],
    git_analysis: ['分析提交', 'Git分析', '仓库统计', '代码审查', 'changelog', '变更影响', 'git log', 'commit分析', '分支比较', '贡献者', '二分查找', 'bisect', 'Bug定位'],
    git_operation: ['提交代码', 'push', 'pull', '合并', 'rebase', '解决冲突', '创建PR', '回滚', '创建分支', '切换分支', 'force push', 'git操作', '版本回退', '提交并推送', 'cherry-pick', '打标签', 'tag', '工作树', 'worktree', 'revert', '回退提交', 'reflog', '恢复提交', '删除标签'],
  },
};
