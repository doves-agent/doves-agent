/**
 * MySQL代理角色定义
 */
export default {
  roles: {
    mysql_connector: {
      description: '数据库连接者 - 配置和验证MySQL数据库连接',
      abilities: ['MySQL', '数据库'],
    },
    mysql_querier: {
      description: 'SQL查询者 - 执行SELECT查询操作',
      abilities: ['MySQL', 'SQL查询', '关联查询'],
    },
    mysql_analyst: {
      description: '表结构分析师 - 查看和分析数据库表结构',
      abilities: ['MySQL', '数据库'],
    },
    mysql_operator: {
      description: '数据操作者 - 执行INSERT/UPDATE/DELETE/导入/导出',
      abilities: ['MySQL', '数据管理', '数据导入', '数据导出'],
    },
    mysql_admin: {
      description: '数据库管理员 - 执行DDL操作（CREATE/ALTER/DROP/BACKUP）',
      abilities: ['MySQL', '数据库'],
    },
  },
};
