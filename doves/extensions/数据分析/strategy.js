/**
 * 数据统计规划策略
 * 数据分析能力组 + 流程案例
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【数据分析能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 数据查询工具',
  '   data_query：自然语言→数据查询（支持SQL/MongoDB/HTTP API）',
  '   data_source_manage：管理数据源配置',
  '',
  '2. 数据分析工具',
  '   data_anomaly_check：异常检测（统计规则+LLM判断）',
  '',
  '3. 数据可视化工具',
  '   data_visualize：生成ECharts图表HTML→OSS托管',
  '   支持图表类型：柱状图/折线图/饼图/散点图/雷达图',
  '',
  '4. 报告工具',
  '   data_report：生成数据分析报告HTML→OSS托管',
  '   报告包含：概述/关键指标/图表/异常/建议',
  '',
  '5. 数据分析技能',
  '   query_builder 技能：查询构建',
  '   report_generator 技能：报表生成',
  '   anomaly_detector 技能：异常检测',
  '',
  '【流程案例】（参考，非强制）',
  '- 简单查询：data_query(自然语言查询) → 整理结果',
  '- 异常检测：data_query(获取数据) → data_anomaly_check(检测异常)',
  '- 数据看板：data_query(获取数据) → data_visualize(生成图表) → 分享链接',
  '- 完整分析：data_query(获取数据) → data_anomaly_check(异常检测) → data_visualize(可视化) → data_report(报告)',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 查询前验证数据源连接',
  '- 可视化应清晰表达数据洞察',
].join('\n');

const 输出格式扩展 = '"analyticsContext": {\n    "dataSource": "数据源名称",\n    "queryType": "sql|mongodb|http_api",\n    "chartType": "bar|line|pie|scatter|radar|table"\n  },';

const 方法论指引 = '请根据用户实际需求，从数据分析能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。使用 data_* 工具和 query_builder/report_generator/anomaly_detector 技能。';

export default {
  strategies: {
    data_analytics: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        '数据分析',
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
