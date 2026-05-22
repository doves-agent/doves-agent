/**
 * Git工具定义
 * 工具定义数组、分类、能力映射、安全分级
 */

export const extTools = [
  {
    name: 'git_repo_add',
    description: '添加仓库到管理列表。支持远程URL（自动clone）和本地路径。配置持久化到云端，跨设备同步。',
    inputSchema: {
      type: 'object',
      properties: {
        地址: { type: 'string', description: '远程仓库URL 或 本地仓库路径（必填）' },
        别名: { type: 'string', description: '仓库友好名称（必填，用于后续引用）' },
        本地路径: { type: 'string', description: '克隆到的本地目录（远程仓库时必填，本地仓库可省略）' },
        默认分支: { type: 'string', description: '默认工作分支（默认main）' },
        认证方式: { type: 'string', enum: ['ssh', 'token', 'none'], description: '认证方式（默认自动检测）' },
      },
      required: ['地址', '别名']
    }
  },
  {
    name: 'git_repo_list',
    description: '列出所有已管理的仓库配置。数据来自云端，跨设备一致。',
    inputSchema: {
      type: 'object',
      properties: {
        状态: { type: 'string', enum: ['active', 'archived', 'all'], description: '筛选状态（默认active）' }
      }
    }
  },
  {
    name: 'git_repo_remove',
    description: '从管理列表中移除仓库（软删除，不删本地文件）。',
    inputSchema: {
      type: 'object',
      properties: {
        仓库: { type: 'string', description: '仓库别名或ID（必填）' }
      },
      required: ['仓库']
    }
  },
  {
    name: 'git_repo_switch',
    description: '切换当前操作的目标仓库（后续 git 操作默认使用该仓库）。',
    inputSchema: {
      type: 'object',
      properties: {
        仓库: { type: 'string', description: '仓库别名或ID（必填）' }
      },
      required: ['仓库']
    }
  },
  {
    name: 'git_history',
    description: '查看操作历史记录（跨设备同步）。',
    inputSchema: {
      type: 'object',
      properties: {
        仓库: { type: 'string', description: '仓库别名或ID（可选，不填则查所有）' },
        操作类型: { type: 'string', description: '筛选操作类型（如push/merge/rebase）' },
        limit: { type: 'number', description: '返回条数（默认20）' }
      }
    }
  },
  {
    name: 'git_push',
    description: 'Push到远程仓库。dangerous操作，需要确认。',
    inputSchema: {
      type: 'object',
      properties: {
        仓库: { type: 'string', description: '目标仓库别名或ID（优先于cwd）' },
        remote: { type: 'string', description: '远程名（默认origin）' },
        branch: { type: 'string', description: '分支名（必填）' },
        force: { type: 'boolean', description: '是否force push（默认false，极度危险）' },
        cwd: { type: 'string', description: '工作目录（若指定仓库则自动填充）' }
      },
      required: ['branch']
    }
  },
  {
    name: 'git_pull',
    description: 'Pull远程更新。支持rebase模式。',
    inputSchema: {
      type: 'object',
      properties: {
        仓库: { type: 'string', description: '目标仓库别名或ID（优先于cwd）' },
        remote: { type: 'string', description: '远程名（默认origin）' },
        branch: { type: 'string', description: '分支名（可选）' },
        rebase: { type: 'boolean', description: '使用rebase模式pull（默认false）' },
        cwd: { type: 'string', description: '工作目录' }
      }
    }
  },
  {
    name: 'git_fetch',
    description: 'Fetch远程信息，不修改工作区。',
    inputSchema: {
      type: 'object',
      properties: {
        仓库: { type: 'string', description: '目标仓库别名或ID（优先于cwd）' },
        remote: { type: 'string', description: '远程名（默认origin）' },
        prune: { type: 'boolean', description: '清理已删除的远程分支（默认false）' },
        cwd: { type: 'string', description: '工作目录' }
      }
    }
  },
  {
    name: 'git_merge',
    description: '合并分支。dangerous操作，操作前建议创建快照。',
    inputSchema: {
      type: 'object',
      properties: {
        仓库: { type: 'string', description: '目标仓库别名或ID（优先于cwd）' },
        branch: { type: 'string', description: '要合并的分支名（必填）' },
        no_ff: { type: 'boolean', description: '禁用快进合并（默认false）' },
        message: { type: 'string', description: '合并提交消息（可选）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['branch']
    }
  },
  {
    name: 'git_rebase',
    description: 'Rebase操作。dangerous操作，操作前建议创建快照。',
    inputSchema: {
      type: 'object',
      properties: {
        仓库: { type: 'string', description: '目标仓库别名或ID（优先于cwd）' },
        branch: { type: 'string', description: 'rebase目标分支（必填）' },
        onto: { type: 'string', description: 'rebase onto指定的提交（可选）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['branch']
    }
  },
  {
    name: 'git_reset',
    description: '回退提交。dangerous操作，操作前强制建议创建快照。',
    inputSchema: {
      type: 'object',
      properties: {
        仓库: { type: 'string', description: '目标仓库别名或ID（优先于cwd）' },
        ref: { type: 'string', description: '回退到的提交引用（必填）' },
        mode: { type: 'string', enum: ['soft', 'mixed', 'hard'], description: 'reset模式（默认mixed）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['ref']
    }
  },
  {
    name: 'git_checkout',
    description: '切换/创建分支。',
    inputSchema: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: '目标分支名（必填）' },
        create: { type: 'boolean', description: '是否创建新分支（默认false）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['branch']
    }
  },
  {
    name: 'git_stash',
    description: '暂存/恢复工作区变更。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'pop', 'list', 'drop', 'apply'], description: 'stash操作类型（必填）' },
        message: { type: 'string', description: 'stash备注（save时可选）' },
        index: { type: 'number', description: 'stash索引（pop/apply/drop时可选，默认0）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['action']
    }
  },
  {
    name: 'git_conflict_resolve',
    description: '读取冲突文件内容，返回冲突标记供LLM分析和生成解决方案。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '冲突文件路径（必填）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['path']
    }
  },
  {
    name: 'git_pr_create',
    description: '创建Pull Request。支持GitHub/GitLab。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'PR标题（必填）' },
        body: { type: 'string', description: 'PR描述（可选，可自动生成）' },
        head: { type: 'string', description: '源分支（必填）' },
        base: { type: 'string', description: '目标分支（默认main）' },
        platform: { type: 'string', enum: ['github', 'gitlab', 'gitee'], description: '平台类型（必填）' },
        repo: { type: 'string', description: '仓库名（如 owner/repo，必填）' },
        token: { type: 'string', description: '访问令牌（可选，优先从项目配置读取）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['title', 'head', 'platform', 'repo']
    }
  },
  {
    name: 'git_pr_list',
    description: '列出Pull Request。支持GitHub/GitLab。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['github', 'gitlab', 'gitee'], description: '平台类型（必填）' },
        repo: { type: 'string', description: '仓库名（如 owner/repo，必填）' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'PR状态（默认open）' },
        token: { type: 'string', description: '访问令牌（可选）' },
        limit: { type: 'number', description: '最大返回数（默认20）' }
      },
      required: ['platform', 'repo']
    }
  },
  {
    name: 'git_pr_review',
    description: '对PR进行审查。返回PR的diff信息供审查。',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['github', 'gitlab', 'gitee'], description: '平台类型（必填）' },
        repo: { type: 'string', description: '仓库名（如 owner/repo，必填）' },
        prNumber: { type: 'number', description: 'PR编号（必填）' },
        token: { type: 'string', description: '访问令牌（可选）' }
      },
      required: ['platform', 'repo', 'prNumber']
    }
  },
  {
    name: 'git_cherry_pick',
    description: 'Cherry-pick指定提交到当前分支。caution操作，可能产生冲突。',
    inputSchema: {
      type: 'object',
      properties: {
        refs: {
          type: 'array',
          items: { type: 'string' },
          description: '要cherry-pick的提交引用数组（必填，支持单个或多个）'
        },
        noCommit: { type: 'boolean', description: '只应用变更但不自动提交（默认false）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['refs']
    }
  },
  {
    name: 'git_tag',
    description: 'Git标签管理：创建/列出/删除标签，支持轻量标签和附注标签。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'delete', 'show'],
          description: '标签操作类型（必填）：create(创建)/list(列出)/delete(删除)/show(查看详情)'
        },
        name: { type: 'string', description: '标签名（create/delete/show时必填）' },
        ref: { type: 'string', description: '打标签的提交引用（create时可选，默认HEAD）' },
        annotate: { type: 'boolean', description: '是否创建附注标签（默认false，轻量标签）' },
        message: { type: 'string', description: '附注标签消息（annotate=true时建议填写）' },
        pattern: { type: 'string', description: '列出标签时的匹配模式（list时可选，如 "v*"）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['action']
    }
  },
  {
    name: 'git_bisect',
    description: 'Git二分查找：定位引入Bug的提交。自动/手动模式。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'good', 'bad', 'skip', 'reset', 'log', 'run'],
          description: 'bisect操作类型（必填）：start(开始)/good(标记好)/bad(标记坏)/skip(跳过)/reset(重置)/log(查看日志)/run(自动运行脚本)'
        },
        goodRef: { type: 'string', description: '已知正常的提交引用（start时可选）' },
        badRef: { type: 'string', description: '已知有Bug的提交引用（start时可选，默认HEAD）' },
        script: { type: 'string', description: '自动测试脚本路径（run时必填，返回0=good, 1=bad, 125=skip）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['action']
    }
  },
  {
    name: 'git_worktree',
    description: 'Git工作树管理：在不切换分支的情况下在多个目录同时工作。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'list', 'remove', 'prune'],
          description: 'worktree操作类型（必填）：add(添加)/list(列出)/remove(移除)/prune(清理)'
        },
        path: { type: 'string', description: '工作树路径（add/remove时必填）' },
        branch: { type: 'string', description: '关联分支名（add时可选，不指定则创建 detached HEAD）' },
        force: { type: 'boolean', description: '强制操作（默认false）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['action']
    }
  },
  {
    name: 'git_reflog',
    description: 'Git引用日志：查看和恢复已丢失的提交，用于误操作回滚。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['show', 'expire', 'delete'],
          description: 'reflog操作类型（必填）：show(查看)/expire(过期清理)/delete(删除条目)'
        },
        count: { type: 'number', description: '显示条数（show时可选，默认20）' },
        ref: { type: 'string', description: '引用名（默认HEAD）' },
        expire: { type: 'string', description: '过期时间（expire时使用，如 "30.days.ago"）' },
        index: { type: 'number', description: '要删除的reflog索引（delete时必填）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['action']
    }
  },
  {
    name: 'git_revert',
    description: '安全回退：创建新提交来撤销指定提交的变更，不修改历史。比git_reset更安全。',
    inputSchema: {
      type: 'object',
      properties: {
        refs: {
          type: 'array',
          items: { type: 'string' },
          description: '要回退的提交引用数组（必填）'
        },
        noCommit: { type: 'boolean', description: '只暂存回退变更但不自动提交（默认false）' },
        noEdit: { type: 'boolean', description: '不打开编辑器修改回退提交消息（默认true）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['refs']
    }
  },
  {
    name: 'git_commit',
    description: '结构化提交：暂存文件并提交，支持自动生成提交消息、Conventional Commits规范。',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '要暂存的文件路径数组（空数组或省略则暂存所有变更）'
        },
        message: { type: 'string', description: '提交消息（必填）' },
        type: {
          type: 'string',
          enum: ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
          description: 'Conventional Commit类型（可选，自动格式化为 type: message）'
        },
        scope: { type: 'string', description: '变更范围（可选，如 git_vcs）' },
        breaking: { type: 'boolean', description: '是否包含破坏性变更（默认false）' },
        amend: { type: 'boolean', description: '修正上一次提交（默认false，caution操作）' },
        allowEmpty: { type: 'boolean', description: '允许空提交（默认false）' },
        cwd: { type: 'string', description: '工作目录' }
      },
      required: ['message']
    }
  }
];

export const extToolCategories = {
  '仓库管理': [
    'git_repo_add', 'git_repo_list', 'git_repo_remove', 'git_repo_switch', 'git_history'
  ],
  'Git高级工具': [
    'git_push', 'git_pull', 'git_fetch', 'git_merge', 'git_rebase',
    'git_reset', 'git_checkout', 'git_stash', 'git_conflict_resolve',
    'git_pr_create', 'git_pr_list', 'git_pr_review',
    'git_cherry_pick', 'git_tag', 'git_bisect', 'git_worktree',
    'git_reflog', 'git_revert', 'git_commit'
  ],
};

export const extToolAbilityMap = {
  git_repo_add: ['Git', '版本控制'],
  git_repo_list: ['Git', '版本控制'],
  git_repo_remove: ['Git', '版本控制'],
  git_repo_switch: ['Git', '版本控制'],
  git_history: ['Git', '版本控制'],
  git_push: ['Git', '版本控制', 'PR管理'],
  git_pull: ['Git', '版本控制'],
  git_fetch: ['Git', '版本控制'],
  git_merge: ['Git', '版本控制'],
  git_rebase: ['Git', '版本控制'],
  git_reset: ['Git', '版本控制'],
  git_checkout: ['Git', '版本控制'],
  git_stash: ['Git', '版本控制'],
  git_conflict_resolve: ['Git', '版本控制'],
  git_pr_create: ['Git', 'PR管理'],
  git_pr_list: ['Git', 'PR管理'],
  git_pr_review: ['Git', '代码审查', 'PR管理'],
  git_cherry_pick: ['Git', '版本控制'],
  git_tag: ['Git', '版本控制'],
  git_bisect: ['Git', '版本控制', '代码分析'],
  git_worktree: ['Git', '版本控制'],
  git_reflog: ['Git', '版本控制'],
  git_revert: ['Git', '版本控制'],
  git_commit: ['Git', '版本控制'],
};

export const extToolSafetyLevels = {
  git_repo_add: '安全',
  git_repo_list: '安全',
  git_repo_remove: '谨慎',
  git_repo_switch: '安全',
  git_history: '安全',
  git_push: '危险',
  git_pull: '谨慎',
  git_fetch: '安全',
  git_merge: '危险',
  git_rebase: '危险',
  git_reset: '危险',
  git_checkout: '谨慎',
  git_stash: '谨慎',
  git_conflict_resolve: '谨慎',
  git_pr_create: '谨慎',
  git_pr_list: '安全',
  git_pr_review: '谨慎',
  git_cherry_pick: '谨慎',
  git_tag: '谨慎',
  git_bisect: '安全',
  git_worktree: '谨慎',
  git_reflog: '安全',
  git_revert: '谨慎',
  git_commit: '谨慎',
};
