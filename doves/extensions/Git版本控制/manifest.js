/**
 * Git版本管理扩展包 manifest
 * 提供Git仓库分析、版本控制、代码审查、PR管理等全流程能力
 */
import { setContext as set仓库Context } from './data/仓库管理.js';
import { setContext as set操作Context } from './data/操作记录.js';
import { setContext as set分析Context } from './data/分析记录.js';
import { setContext as set记忆Context } from './data/记忆.js';

export default {
  // 基本信息
  name: 'Git版本控制',
  version: '1.0.0',
  description: 'Git全面接管扩展包 - 从commit到PR全流程智能体化（含高级工具+冲突解决+PR管理）',
  abilities: ['Git', '代码分析', '版本控制', '代码审查', 'PR管理', '冲突解决', '标签管理', 'Cherry-pick', '工作树', 'Bug定位'],

  // 依赖（应用间解耦，不再需要静态依赖）
  dependencies: [],

  // LLM层声明
  intent: './intent.js',
  strategy: './strategy.js',
  roles: './roles.js',
  execution: './execution.js',
  review: './review.js',         // 危险操作审核规则
  workflow: './workflow.js',

  // 工具层声明
  skills: './skills',
  tools: './tools',             // Git高级工具（19个：push/pull/fetch/merge/rebase/reset/checkout/stash/conflict_resolve/pr_create/pr_list/pr_review/cherry_pick/tag/bisect/worktree/reflog/revert/commit）

  // ===== 开发者凭证 =====
  developer: {
    id: 'dev_official',
    signature: 'hmac-sha256:4bffa6547a11374f7cc62ed0103b0455dd32d2fcf9c381e1c36fe790ea5497f1',
  },

  // ===== 接口底座：权限声明 =====
  permissions: {
    databases: {
      'Git版本控制': {
        collections: {
          '仓库配置': {
            actions: ['find', 'findOne', 'insertOne', 'updateOne', 'deleteOne', 'countDocuments', 'index'],
            scope: 'user_scoped',
            userField: 'user_id',
          },
          '操作记录': {
            actions: ['find', 'findOne', 'insertOne', 'aggregate', 'countDocuments', 'index'],
            scope: 'user_scoped',
            userField: 'user_id',
          },
          '分析记录': {
            actions: ['find', 'findOne', 'insertOne', 'aggregate', 'countDocuments', 'index'],
            scope: 'user_scoped',
            userField: 'user_id',
          },
        },
      },
    },
    storage: {
      'git-storage': { actions: ['cloneSnapshot', 'status'], scope: 'user_scoped' },
      memory: { actions: ['search', 'write', 'delete'], scope: 'user_scoped' },
    },
  },

  // ===== 初始化钩子 =====
  async onInit(ctx) {
    set仓库Context(ctx);
    set操作Context(ctx);
    set分析Context(ctx);
    set记忆Context(ctx);
  },

  // Web 页面声明（供 CLI Web 动态注入）
  web: {
    nav: { icon: '🔀', label: 'Git' },
    pages: {
      'git-repos':         { title: '仓库管理',  entry: './web/repos.html' },
      'git-status':        { title: '仓库状态',  entry: './web/status.html' },
      'git-branches':      { title: '分支管理',  entry: './web/branches.html' },
      'git-changelog':     { title: '变更日志',  entry: './web/changelog.html' },
      'git-conflicts':     { title: '冲突解决',  entry: './web/conflicts.html' },
      'git-pull-requests': { title: 'Pull Requests', entry: './web/pull-requests.html' },
    },
  },
};
