/**
 * MongoDB代理规划策略
 * 扩展 = 能力组 + 流程案例
 *
 * 描述可用工具能力 + 提供流程案例参考
 * LLM 根据用户实际请求自行决策工具组合
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【MongoDB能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 数据查询工具',
  '   mongo_find：条件查询（支持排序/分页/字段筛选）',
  '   mongo_find_one：单条查询',
  '   mongo_count_documents：计数',
  '   mongo_distinct：去重',
  '   mongo_aggregate：聚合管道',
  '',
  '2. 数据写入工具',
  '   mongo_insert_one / mongo_insert_many：插入',
  '   mongo_update_one / mongo_update_many：更新',
  '   mongo_replace_one：替换（保留_id）',
  '   mongo_delete_one / mongo_delete_many：删除',
  '',
  '3. 导入导出工具',
  '   mongo_import：导入（JSON/CSV）',
  '   mongo_export：导出（JSON/CSV）',
  '',
  '4. 索引管理工具',
  '   mongo_list_indexes：查看索引',
  '   mongo_create_index：创建索引',
  '   mongo_drop_index：删除索引',
  '',
  '5. 集合信息工具',
  '   mongo_connect：检查/配置连接',
  '   mongo_list_collections：列出集合',
  '   mongo_collection_stats：集合统计',
  '',
  '【流程案例】（参考，非强制）',
  '- 查询数据：mongo_find / mongo_aggregate / mongo_count',
  '- 写入数据：mongo_count(确认影响范围) → mongo_insertOne / mongo_updateOne',
  '- 导入导出：mongo_export / mongo_import',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 写入操作前建议先查询确认影响范围',
  '- 删除操作建议先展示匹配数量',
  '- 大数据量查询建议加 limit',
  '- 禁止 DROP DATABASE / dropDatabase()',
  '- 禁止 $where（不允许执行任意 JavaScript）',
].join('\n');

const 输出格式 = '"mongoOperation": {\n    "operationType": "connect|query|aggregate|insert|update|replace|delete|import|export|index|listCollections|stats|count",\n    "collection": "目标集合名",\n    "estimatedDocCount": 0,\n    "needsConfirmation": false\n  },';

const 方法论指引 = '请根据用户实际需求，从MongoDB能力组中选择合适的工具组合。流程案例仅供参考，修改数据前确认影响范围。';

export default {
  strategies: {
    mongo_agent: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        'MongoDB数据库代理',
        方法论段落,
        输出格式,
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
