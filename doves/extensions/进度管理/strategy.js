/**
 * 进度管理规划策略
 * 进度管理能力组 + 流程案例
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【进度管理能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 任务操作工具',
  '   task_create：创建任务（禅道/Jira）',
  '   task_update：更新任务状态/进度',
  '   pm_task_query：查询任务/进度/里程碑',
  '',
  '2. 状态同步工具',
  '   task_sync：Git commit → 禅道/Jira状态同步',
  '   映射规则：白鸽Branch→外部Epic, SubTask→Story, READY→开发中, COMPLETED→已完成',
  '',
  '3. 里程碑管理工具',
  '   milestone_manage：管理里程碑',
  '',
  '4. 报告工具',
  '   progress_report：生成周报/月报（进展/计划/风险/里程碑达成率）',
  '',
  '5. 外部平台技能',
  '   zentao 技能：禅道集成',
  '   jira 技能：Jira集成',
  '   progress_sync 技能：进度同步',
  '   weekly_report 技能：周报生成',
  '',
  '【流程案例】（参考，非强制）',
  '- 创建任务：task_create(创建) → task_sync(同步到外部平台)',
  '- 查询进度：pm_task_query(查询) → progress_report(生成报告)',
  '- 状态同步：task_sync(将Git提交同步到禅道/Jira)',
  '- 周报输出：pm_task_query(获取进度) → progress_report(生成周报) → 页面托管(可选)',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 确定目标平台（禅道/Jira/白鸽内部）后再选择对应工具和技能',
  '- 确定关联范围（项目/迭代/里程碑）以缩小查询范围',
].join('\n');

const 输出格式扩展 = '"pmContext": {\n    "platform": "zentao|jira|internal",\n    "project": "项目ID",\n    "sprint": "迭代ID"\n  },';

const 方法论指引 = '请根据用户实际需求，从进度管理能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。使用 task_* 工具和 zentao/jira/progress_sync/weekly_report 技能。';

export default {
  strategies: {
    project_mgmt: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        '进度管理',
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
