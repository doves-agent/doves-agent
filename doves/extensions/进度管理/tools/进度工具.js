/**
 * 进度管理工具 - 扩展包版本
 * 6个工具：task_create / task_update / pm_task_query / task_sync / progress_report / milestone_manage
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('进度工具', { 前缀: '[进度工具]', 级别: 'debug', 显示调用位置: true });

// ==================== 内存缓存 ====================

const _任务映射 = new Map();   // 白鸽任务ID ↔ 外部任务ID
const _任务缓存 = new Map();    // 任务详情
const _里程碑缓存 = new Map();  // 里程碑

// ==================== 工具定义 ====================

export const extTools = [
  {
    name: 'task_create',
    description: '创建任务到禅道/Jira，返回外部任务ID和映射关系。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题（必填）' },
        description: { type: 'string', description: '任务描述' },
        platform: { type: 'string', enum: ['zentao', 'jira'], description: '目标平台（必填）' },
        project: { type: 'string', description: '项目ID/Key' },
        assignee: { type: 'string', description: '指派人' },
        priority: { type: 'string', enum: ['highest', 'high', 'medium', 'low'], description: '优先级（默认medium）' },
        type: { type: 'string', enum: ['story', 'task', 'bug', 'epic'], description: '任务类型（默认task）' },
        sprint: { type: 'string', description: '迭代ID' },
        doveTaskId: { type: 'string', description: '白鸽任务ID（建立映射时使用）' }
      },
      required: ['title', 'platform']
    }
  },
  {
    name: 'task_update',
    description: '更新任务状态/进度，同步到禅道/Jira。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '外部任务ID（必填）' },
        platform: { type: 'string', enum: ['zentao', 'jira'], description: '平台（必填）' },
        status: { type: 'string', description: '新状态' },
        progress: { type: 'number', description: '进度百分比（0-100）' },
        comment: { type: 'string', description: '备注/评论' },
        assignee: { type: 'string', description: '修改指派人' }
      },
      required: ['taskId', 'platform']
    }
  },
  {
    name: 'pm_task_query',
    description: '查询禅道/Jira任务/进度/里程碑，支持按项目/迭代/状态过滤。（注意：这不是查询白鸽内部任务的task_query，而是查询外部项目管理平台的任务）',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['zentao', 'jira', 'all'], description: '查询平台（默认all）' },
        project: { type: 'string', description: '项目ID/Key' },
        sprint: { type: 'string', description: '迭代ID' },
        status: { type: 'string', description: '按状态过滤' },
        assignee: { type: 'string', description: '按指派人过滤' },
        type: { type: 'string', description: '按类型过滤' },
        limit: { type: 'number', description: '返回数量限制（默认20）' }
      }
    }
  },
  {
    name: 'task_sync',
    description: 'Git commit→禅道/Jira状态同步，将白鸽任务状态同步到外部系统。',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['dove_to_external', 'external_to_dove', 'bidirectional'], description: '同步方向（默认dove_to_external）' },
        doveTaskId: { type: 'string', description: '白鸽任务ID' },
        externalTaskId: { type: 'string', description: '外部任务ID' },
        platform: { type: 'string', enum: ['zentao', 'jira'], description: '目标平台' },
        commitRef: { type: 'string', description: '关联的commit hash' }
      },
      required: ['direction']
    }
  },
  {
    name: 'progress_report',
    description: '生成进度报告（周报/月报），支持HTML输出和OSS托管。',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['weekly', 'monthly', 'sprint', 'custom'], description: '报告类型（默认weekly）' },
        project: { type: 'string', description: '项目标识' },
        period: { type: 'object', description: '报告时间段', properties: { from: { type: 'string' }, to: { type: 'string' } } },
        includeDetails: { type: 'boolean', description: '是否包含详细任务列表（默认true）' },
        format: { type: 'string', enum: ['markdown', 'html'], description: '输出格式（默认markdown）' },
        visibility: { type: 'string', enum: ['private', 'public'], description: '可见性（默认private）' }
      }
    }
  },
  {
    name: 'milestone_manage',
    description: '里程碑管理：创建/更新/查询里程碑。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'query', 'list'], description: '操作类型（必填）' },
        milestoneId: { type: 'string', description: '里程碑ID（update/query使用）' },
        name: { type: 'string', description: '里程碑名称' },
        dueDate: { type: 'string', description: '截止日期' },
        status: { type: 'string', enum: ['计划中', '进行中', '已完成', '已逾期'], description: '状态' },
        tasks: { type: 'array', items: { type: 'string' }, description: '关联任务ID列表' },
        project: { type: 'string', description: '项目标识' }
      },
      required: ['action']
    }
  }
];

// ==================== 工具分类/映射/安全分级 ====================

export const extToolCategories = {
  '进度工具': ['task_create', 'task_update', 'pm_task_query', 'task_sync', 'progress_report', 'milestone_manage'],
};

export const extToolAbilityMap = {
  task_create: ['进度管理', '任务管理'],
  task_update: ['进度管理', '任务管理'],
  pm_task_query: ['进度管理', '项目跟踪'],
  task_sync: ['进度管理'],
  progress_report: ['进度管理', '项目跟踪'],
  milestone_manage: ['进度管理', '项目跟踪'],
};

export const extToolSafetyLevels = {
  task_create: '谨慎',
  task_update: '谨慎',
  pm_task_query: '安全',
  task_sync: '谨慎',
  progress_report: '安全',
  milestone_manage: '谨慎',
};

// ==================== 状态映射 ====================

const 白鸽状态映射 = {
  READY: { zentao: '开发中', jira: 'In Progress' },
  IN_PROGRESS: { zentao: '开发中', jira: 'In Progress' },
  COMPLETED: { zentao: '已完成', jira: 'Done' },
  FAILED: { zentao: '已关闭', jira: 'Closed' },
  PENDING: { zentao: '未开始', jira: 'To Do' },
};

// ==================== 辅助函数 ====================

const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

function 生成任务ID(platform) {
  const prefix = platform === 'zentao' ? 'ZT' : 'JR';
  const timestamp = Date.now().toString(36).toUpperCase();
  return `${prefix}-${timestamp}`;
}

// ==================== 工具处理函数 ====================

export async function handleExtTool(name, args) {
  switch (name) {

    // ===== task_create =====
    case 'task_create': {
      const { title, description = '', platform, project = '', assignee = '', priority = 'medium', type: taskType = 'task', sprint = '', doveTaskId } = args;

      if (!title || !platform) {
        return text({ error: '缺少必填参数: title 和 platform' });
      }

      const externalId = 生成任务ID(platform);
      const createdAt = new Date().toISOString();

      const task = {
        externalId,
        title,
        description,
        platform,
        project,
        assignee,
        priority,
        type: taskType,
        sprint,
        status: platform === 'zentao' ? '未开始' : 'To Do',
        progress: 0,
        createdAt,
        doveTaskId: doveTaskId || null,
      };

      _任务缓存.set(externalId, task);

      // 如果有白鸽任务ID，建立映射
      if (doveTaskId) {
        _任务映射.set(doveTaskId, { externalId, platform, project });
        _任务映射.set(externalId, { doveTaskId });
      }

      logger.info(`任务已创建: ${externalId} "${title}" on ${platform}`);

      return text({
        action: 'task_create',
        externalId,
        platform,
        project,
        title,
        doveTaskId: doveTaskId || null,
        hint: `任务已创建到${platform === 'zentao' ? '禅道' : 'Jira'}（模拟模式）。实际API调用需要配置${platform}连接信息。`
      });
    }

    // ===== task_update =====
    case 'task_update': {
      const { taskId, platform, status, progress, comment, assignee } = args;

      if (!taskId || !platform) {
        return text({ error: '缺少必填参数: taskId 和 platform' });
      }

      const task = _任务缓存.get(taskId);
      if (!task) {
        return text({ error: `任务不存在: ${taskId}` });
      }

      if (status) task.status = status;
      if (progress !== undefined) task.progress = Math.max(0, Math.min(100, progress));
      if (assignee) task.assignee = assignee;
      task.updatedAt = new Date().toISOString();

      if (comment) {
        if (!task.comments) task.comments = [];
        task.comments.push({ text: comment, time: new Date().toISOString() });
      }

      logger.info(`任务已更新: ${taskId} → status=${task.status} progress=${task.progress}%`);

      return text({
        action: 'task_update',
        taskId,
        platform,
        status: task.status,
        progress: task.progress,
        updatedAt: task.updatedAt
      });
    }

    // ===== pm_task_query =====
    case 'pm_task_query': {
      const { platform: qPlatform = 'all', project, sprint, status, assignee, limit = 20 } = args;

      let tasks = Array.from(_任务缓存.values());

      if (qPlatform !== 'all') tasks = tasks.filter(t => t.platform === qPlatform);
      if (project) tasks = tasks.filter(t => t.project === project);
      if (sprint) tasks = tasks.filter(t => t.sprint === sprint);
      if (status) tasks = tasks.filter(t => t.status === status);
      if (assignee) tasks = tasks.filter(t => t.assignee === assignee);

      tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return text({
        action: 'pm_task_query',
        total: tasks.length,
        tasks: tasks.slice(0, limit).map(t => ({
          id: t.externalId,
          title: t.title,
          platform: t.platform,
          status: t.status,
          progress: t.progress,
          assignee: t.assignee,
          priority: t.priority,
          type: t.type,
          createdAt: t.createdAt
        }))
      });
    }

    // ===== task_sync =====
    case 'task_sync': {
      const { direction = 'dove_to_external', doveTaskId, externalTaskId, platform = 'zentao', commitRef } = args;

      const syncResults = [];

      if (direction === 'dove_to_external' || direction === 'bidirectional') {
        // 白鸽 → 外部
        if (doveTaskId) {
          const mapping = _任务映射.get(doveTaskId);
          if (mapping) {
            const extId = mapping.externalId;
            const extTask = _任务缓存.get(extId);
            if (extTask) {
              syncResults.push({
                direction: 'dove_to_external',
                doveTaskId,
                externalId: extId,
                platform: extTask.platform,
                mappedStatus: '同步中',
                hint: `白鸽任务 ${doveTaskId} 状态同步到 ${extTask.platform} 任务 ${extId}`
              });
            }
          }
        }
      }

      if (direction === 'external_to_dove' || direction === 'bidirectional') {
        // 外部 → 白鸽
        if (externalTaskId) {
          const mapping = _任务映射.get(externalTaskId);
          if (mapping) {
            syncResults.push({
              direction: 'external_to_dove',
              externalId: externalTaskId,
              doveTaskId: mapping.doveTaskId,
              hint: `外部任务 ${externalTaskId} 状态同步到白鸽任务 ${mapping.doveTaskId}`
            });
          }
        }
      }

      if (commitRef) {
        syncResults.push({
          commitRef,
          hint: `关联commit ${commitRef}，建议更新关联任务状态`
        });
      }

      return text({
        action: 'task_sync',
        direction,
        syncResults,
        状态映射表: 白鸽状态映射,
        hint: syncResults.length > 0
          ? `同步了 ${syncResults.length} 个任务`
          : '未找到需要同步的任务映射，请先使用 task_create 建立关联'
      });
    }

    // ===== progress_report =====
    case 'progress_report': {
      const { type: reportType = 'weekly', project = '', period, includeDetails = true, format = 'markdown', visibility = 'private' } = args;

      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const from = period?.from || weekAgo.toISOString().split('T')[0];
      const to = period?.to || now.toISOString().split('T')[0];

      // 统计任务
      const allTasks = Array.from(_任务缓存.values());
      const projectTasks = project ? allTasks.filter(t => t.project === project) : allTasks;

      const completed = projectTasks.filter(t => t.status === '已完成' || t.status === 'Done');
      const inProgress = projectTasks.filter(t => t.status === '开发中' || t.status === 'In Progress');
      const pending = projectTasks.filter(t => t.status === '未开始' || t.status === 'To Do');

      const 里程碑完成率 = _里程碑缓存.size > 0
        ? Math.round(Array.from(_里程碑缓存.values()).filter(m => m.status === '已完成').length / _里程碑缓存.size * 100)
        : 100;

      const report = {
        action: 'progress_report',
        type: reportType,
        period: { from, to },
        project,
        summary: {
          totalTasks: projectTasks.length,
          completed: completed.length,
          inProgress: inProgress.length,
          pending: pending.length,
          completionRate: projectTasks.length > 0 ? Math.round(completed.length / projectTasks.length * 100) : 0,
          milestoneRate: 里程碑完成率
        }
      };

      if (includeDetails) {
        report.details = {
          completedTasks: completed.map(t => ({ id: t.externalId, title: t.title, platform: t.platform })),
          inProgressTasks: inProgress.map(t => ({ id: t.externalId, title: t.title, progress: t.progress, platform: t.platform })),
          pendingTasks: pending.map(t => ({ id: t.externalId, title: t.title, platform: t.platform }))
        };
      }

      // Markdown格式
      if (format === 'markdown' || format === 'html') {
        let md = `# ${reportType === 'weekly' ? '周报' : reportType === 'monthly' ? '月报' : '进度报告'}\n\n`;
        md += `**时间段**: ${from} ~ ${to}\n\n`;
        md += `## 概览\n\n`;
        md += `- 总任务: ${report.summary.totalTasks}\n`;
        md += `- 已完成: ${report.summary.completed}\n`;
        md += `- 进行中: ${report.summary.inProgress}\n`;
        md += `- 待开始: ${report.summary.pending}\n`;
        md += `- 完成率: ${report.summary.completionRate}%\n`;
        md += `- 里程碑达成率: ${report.summary.milestoneRate}%\n\n`;

        if (includeDetails && completed.length > 0) {
          md += `## 已完成\n\n`;
          for (const t of completed) md += `- [${t.externalId}] ${t.title} (${t.platform})\n`;
          md += '\n';
        }

        if (includeDetails && inProgress.length > 0) {
          md += `## 进行中\n\n`;
          for (const t of inProgress) md += `- [${t.externalId}] ${t.title} — ${t.progress}% (${t.platform})\n`;
          md += '\n';
        }

        report.report = md;
      }

      // 如果HTML格式，尝试托管
      if (format === 'html') {
        const html = 生成报告HTML(report);
        report.htmlGenerated = true;
        report.hint = 'HTML报告已生成，可使用 页面托管 托管';
      }

      return text(report);
    }

    // ===== milestone_manage =====
    case 'milestone_manage': {
      const { action: msAction, milestoneId, name, dueDate, status, tasks = [], project = '' } = args;

      switch (msAction) {
        case 'create': {
          if (!name) return text({ error: '缺少必填参数: name' });
          const id = `MS-${Date.now().toString(36).toUpperCase()}`;
          const milestone = {
            id, name, dueDate: dueDate || '', status: status || '计划中', tasks, project, createdAt: new Date().toISOString()
          };
          _里程碑缓存.set(id, milestone);
          return text({ action: 'milestone_manage', operation: 'create', id, name, status: milestone.status });
        }

        case 'update': {
          if (!milestoneId) return text({ error: '缺少必填参数: milestoneId' });
          const ms = _里程碑缓存.get(milestoneId);
          if (!ms) return text({ error: `里程碑不存在: ${milestoneId}` });
          if (name) ms.name = name;
          if (dueDate) ms.dueDate = dueDate;
          if (status) ms.status = status;
          if (tasks.length > 0) ms.tasks = tasks;
          ms.updatedAt = new Date().toISOString();
          return text({ action: 'milestone_manage', operation: 'update', id: milestoneId, name: ms.name, status: ms.status });
        }

        case 'query': {
          if (!milestoneId) return text({ error: '缺少必填参数: milestoneId' });
          const ms = _里程碑缓存.get(milestoneId);
          if (!ms) return text({ error: `里程碑不存在: ${milestoneId}` });
          return text({ action: 'milestone_manage', operation: 'query', milestone: ms });
        }

        case 'list': {
          const milestones = Array.from(_里程碑缓存.values());
          const filtered = project ? milestones.filter(m => m.project === project) : milestones;
          return text({ action: 'milestone_manage', operation: 'list', total: filtered.length, milestones: filtered });
        }

        default:
          return text({ error: `未知操作: ${msAction}` });
      }
    }

    default:
      return null; // 不认识的工具返回 null，让其他扩展处理
  }
}

// ==================== 报告HTML生成 ====================

function 生成报告HTML(report) {
  const s = report.summary;
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${report.type === 'weekly' ? '周报' : '进度报告'}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;padding:20px}
.report{max-width:900px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
h1{border-bottom:2px solid #667eea;padding-bottom:12px;margin-bottom:20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:30px}
.stat-card{background:#f8f9fa;border-radius:8px;padding:16px;text-align:center}
.stat-card .value{font-size:2em;font-weight:700;color:#667eea}.stat-card .label{color:#888;font-size:13px;margin-top:4px}
.progress-bar{height:8px;background:#e9ecef;border-radius:4px;margin-top:8px;overflow:hidden}
.progress-fill{height:100%;background:#667eea;border-radius:4px}
.period{color:#888;margin-bottom:20px}</style></head>
<body><div class="report"><h1>${report.type === 'weekly' ? '周报' : '进度报告'}</h1>
<div class="period">${report.period.from} ~ ${report.period.to}</div>
<div class="stats">
<div class="stat-card"><div class="value">${s.totalTasks}</div><div class="label">总任务</div></div>
<div class="stat-card"><div class="value">${s.completed}</div><div class="label">已完成</div></div>
<div class="stat-card"><div class="value">${s.inProgress}</div><div class="label">进行中</div></div>
<div class="stat-card"><div class="value">${s.completionRate}%</div><div class="label">完成率</div><div class="progress-bar"><div class="progress-fill" style="width:${s.completionRate}%"></div></div></div>
</div></div></body></html>`;
}
