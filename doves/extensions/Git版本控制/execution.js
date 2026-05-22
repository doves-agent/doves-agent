/**
 * Git版本管理执行器增强
 * 条件性系统提示词 + Git操作后的变更联动Hook
 */

import { 触发变更联动, 构建变更事件 } from '../../tools/变更联动.js';

export default {
  // 条件性系统提示词片段
  conditionalPrompts: [
    {
      // 匹配条件：任务能力需求包含Git/版本控制/代码审查/PR管理
      match: (任务, tools) => {
        const 能力需求 = 任务.能力需求 || [];
        return 能力需求.some(a => ['Git', '版本控制', '代码审查', '代码分析', 'PR管理'].includes(a));
      },
      // 注入到系统提示词末尾
      prompt: `【Git分析工具优先级】
- 仓库状态 → Git操作 (status)
- 提交历史 → Git操作 (log) 或 Git文件历史
- 变更详情 → Git差异
- 代码溯源 → Git溯源
- 分支对比 → Git对比
- 仓库统计 → Git统计
- 提交搜索 → Git搜索
- 语义分析 → git_analysis 技能（提交分类、审查建议、changelog、文档关联检查）
- Bug定位 → git_bisect（二分查找引入Bug的提交）
注意：不要使用 执行命令 执行 git 命令，优先使用结构化的 Git操作 等工具

【Git操作工具优先级】
- 提交代码 → git_commit（支持Conventional Commits）
- Push → git_push（dangerous，需确认）
- Pull → git_pull
- Fetch → git_fetch
- Merge → git_merge（dangerous，操作前建议快照）
- Rebase → git_rebase（dangerous，操作前建议快照）
- 安全回退 → git_revert（推荐，不修改历史）
- 强制回退 → git_reset（dangerous，操作前强制快照）
- 切换/创建分支 → git_checkout
- 暂存变更 → git_stash
- 冲突解决 → git_conflict_resolve + conflict_resolver 技能（auto_merge/batch_resolve/resolve）
- 创建PR → pr_manager 技能(generate_description) + git_pr_create
- 列出PR → git_pr_list
- PR审查 → git_pr_review
- PR管理 → pr_manager 技能(review_submit/merge_pr/status_track/template_generate)
- Cherry-pick → git_cherry_pick
- 标签管理 → git_tag
- 工作树 → git_worktree
- 恢复提交 → git_reflog`,
    },
  ],

  // Git操作后的变更联动Hook
  hooks: {
    afterToolCall: async (工具名, 结果, 任务) => {
      // commit完成后触发变更联动
      if (工具名 === 'Git操作' && 结果?.content) {
        try {
          const text = 结果.content[0]?.text || '';
          const parsed = JSON.parse(text);
          if (parsed.action === 'commit' && parsed.success) {
            const event = 构建变更事件('commit', parsed, 任务);
            await 触发变更联动(event, { 任务 });
          }
        } catch { /* 解析失败，忽略 */ }
      }
      // git_commit完成后触发变更联动
      if (工具名 === 'git_commit') {
        try {
          const text = 结果?.content?.[0]?.text || '';
          const parsed = JSON.parse(text);
          if (parsed.success) {
            const event = 构建变更事件('commit', parsed, 任务);
            await 触发变更联动(event, { 任务 });
          }
        } catch { /* 忽略 */ }
      }
      // merge完成后触发联动
      if (工具名 === 'git_merge') {
        try {
          const text = 结果?.content?.[0]?.text || '';
          const parsed = JSON.parse(text);
          if (parsed.success) {
            const event = 构建变更事件('merge', parsed, 任务);
            await 触发变更联动(event, { 任务 });
          }
        } catch { /* 忽略 */ }
      }
      // push完成后触发联动
      if (工具名 === 'git_push') {
        try {
          const text = 结果?.content?.[0]?.text || '';
          const parsed = JSON.parse(text);
          if (parsed.success) {
            const event = 构建变更事件('push', parsed, 任务);
            await 触发变更联动(event, { 任务 });
          }
        } catch { /* 忽略 */ }
      }
      // cherry-pick完成后如果产生冲突，触发冲突解决联动
      if (工具名 === 'git_cherry_pick') {
        try {
          const text = 结果?.content?.[0]?.text || '';
          const parsed = JSON.parse(text);
          if (parsed.conflict) {
            const event = 构建变更事件('conflict', { source: 'cherry_pick', ...parsed }, 任务);
            await 触发变更联动(event, { 任务 });
          }
        } catch { /* 忽略 */ }
      }
      // revert完成后触发联动
      if (工具名 === 'git_revert') {
        try {
          const text = 结果?.content?.[0]?.text || '';
          const parsed = JSON.parse(text);
          if (parsed.success) {
            const event = 构建变更事件('revert', parsed, 任务);
            await 触发变更联动(event, { 任务 });
          }
        } catch { /* 忽略 */ }
      }
    }
  }
};

// ==================== Git VCS 联动处理器注册 ====================
// Git版本控制 作为事件源头，也注册一些自身需要的联动处理器

try {
  const { 注册联动处理器: 注册 } = await import('../../tools/变更联动.js');

  // 审查通过后 → 自动push + 创建PR
  注册('git_vcs_on_review_pass', {
    match: (gitEvent) => gitEvent.type === 'review_pass',
    execute: async (gitEvent, 上下文) => {
      return { 建议: '代码审查通过，建议使用 git_push 推送代码并使用 git_pr_create 创建PR' };
    }
  }, 'Git版本控制');

  // push完成后 → 提示创建PR
  注册('git_vcs_on_push', {
    match: (gitEvent) => gitEvent.type === 'push',
    execute: async (gitEvent, 上下文) => {
      return { 建议: '代码已推送，建议使用 git_pr_create 创建Pull Request' };
    }
  }, 'Git版本控制');

} catch { /* 模块加载时可能还未初始化 */ }
