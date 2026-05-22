/**
 * Git版本控制能力组声明
 * 扩展 = 能力组 + 流程案例
 */
export default {
  场景: ['Git', '提交代码', 'push', 'pull', '合并', 'rebase', '解决冲突', '创建PR', '回滚'],

  能力组: [
    {
      名称: '仓库分析',
      触发关键词: ['分析提交', 'Git分析', '仓库统计', '分支比较', '贡献者', 'Bug定位', 'git log'],
      说明: '分析提交历史、分支差异、贡献统计、二分定位Bug',
      工具: ['git_log', 'git_diff', 'git_branch_list', 'git_bisect'],
    },
    {
      名称: '版本操作',
      触发关键词: ['提交代码', 'push', 'pull', '合并', 'rebase', '创建分支', '切换分支', 'cherry-pick', '打标签'],
      说明: '常规 Git 操作：commit/push/pull/merge/rebase/branch/tag',
      工具: ['git_commit', 'git_push', 'git_pull', 'git_merge', 'git_rebase', 'git_checkout', 'git_tag', 'git_cherry_pick'],
    },
    {
      名称: '冲突解决',
      触发关键词: ['解决冲突', '冲突', 'merge conflict', '合并冲突'],
      说明: '检测冲突文件，展示冲突内容，辅助解决',
      工具: ['git_conflict_resolve', 'git_status', 'git_diff'],
    },
    {
      名称: 'PR管理',
      触发关键词: ['创建PR', 'PR列表', '审查PR', 'code review'],
      说明: '创建/列表/审查 Pull Request',
      工具: ['git_pr_create', 'git_pr_list', 'git_pr_review'],
    },
  ],

  流程案例: [
    {
      名称: '提交发布',
      适用场景: '用户说"提交代码"、"push"',
      流程: 'git_diff(确认变更) → git_commit → git_push',
    },
    {
      名称: '解决冲突',
      适用场景: '用户说"有冲突"、"合并冲突"',
      流程: 'git_status / git_diff(查看冲突) → git_conflict_resolve(解决)',
    },
    {
      名称: '历史分析',
      适用场景: '用户说"看看提交历史"、"谁改了这个"',
      流程: 'git_log / git_diff / git_branch_list',
    },
  ],

  关键规则: [
    '流程案例仅供参考，根据用户实际需求灵活组合工具',
    '危险操作（force push/reset --hard）建议先确认',
    '合并冲突时建议展示冲突内容让用户决策',
    'commit 前建议先 git diff 确认变更内容',
  ],
};
