/**
 * MongoDB代理角色定义
 */
export default {
  roles: {
    mongo_connector: {
      description: '数据库连接者 - 配置和验证MongoDB数据库连接',
      abilities: ['MongoDB', '数据库'],
    },
    mongo_querier: {
      description: '数据查询者 - 执行MongoDB查询操作',
      abilities: ['MongoDB', '数据查询'],
    },
    mongo_analyst: {
      description: '数据聚合分析者 - 执行聚合管道分析',
      abilities: ['MongoDB', '数据聚合', '数据查询'],
    },
    mongo_operator: {
      description: '数据操作者 - 执行数据插入/更新/删除/导入/导出',
      abilities: ['MongoDB', '数据管理', '数据导入', '数据导出'],
    },
    mongo_admin: {
      description: '数据库管理员 - 管理索引和集合',
      abilities: ['MongoDB', '索引管理'],
    },
  },
};
