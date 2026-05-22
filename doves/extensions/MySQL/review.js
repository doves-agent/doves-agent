/**
 * MySQL代理审核规则
 * 安全第一：防止数据损坏和SQL注入
 */
export default {
  customChecks: [
    {
      name: 'mysql_agent_safety',
      check: (规划结果, 原始任务) => {
        const 子任务列表 = 规划结果.subTasks || [];
        const warnings = [];
        const errors = [];

        for (const 子任务 of 子任务列表) {
          const 工具名 = 子任务.toolName || 子任务.工具名 || '';
          const desc = 子任务.description || '';
          const sql = (子任务.arguments?.sql || 子任务.arguments?.query || '').toUpperCase().trim();

          // 禁止 DROP DATABASE
          if (sql.includes('DROP DATABASE') || 工具名 === 'mysql_drop_database') {
            errors.push(`禁止操作: 子任务 "${子任务.id || 'unknown'}" 试图删除整个数据库，此操作被严格禁止`);
          }

          // DELETE/UPDATE 必须有 WHERE
          if ((sql.startsWith('DELETE') || sql.startsWith('UPDATE')) && !sql.includes('WHERE')) {
            errors.push(
              `无条件写操作: 子任务 "${子任务.id || 'unknown'}" 的SQL没有WHERE条件：${sql.slice(0, 100)}，这将影响所有行。请添加WHERE条件`
            );
          }

          // 检查多语句注入
          if (sql.includes(';') && sql.indexOf(';') < sql.length - 1) {
            const statements = sql.split(';').filter(s => s.trim().length > 0);
            if (statements.length > 1) {
              errors.push(
                `多语句检测: 子任务 "${子任务.id || 'unknown'}" 包含多条SQL语句，此操作被禁止（防注入）`
              );
            }
          }

          // 没有LIMIT的SELECT提醒
          if (sql.startsWith('SELECT') && !sql.includes('LIMIT') && !sql.includes('COUNT(')) {
            warnings.push(
              `无限制查询: 子任务 "${子任务.id || 'unknown'}" 的SELECT查询没有LIMIT，大数据表时可能导致性能问题。默认限制200行`
            );
          }

          // DROP操作提醒
          if (工具名 === 'mysql_drop_table' || sql.startsWith('DROP TABLE')) {
            warnings.push(
              `危险操作: 子任务 "${子任务.id || 'unknown'}" 涉及删除表，请确认表名正确，且已备份数据`
            );
          }

          // ALTER提醒
          if (工具名 === 'mysql_alter_table' || sql.startsWith('ALTER TABLE')) {
            warnings.push(
              `结构变更: 子任务 "${子任务.id || 'unknown'}" 涉及修改表结构，大表上ALTER操作可能耗时较长并锁定表`
            );
          }

          // TRUNCATE提醒
          if (工具名 === 'mysql_truncate_table' || sql.startsWith('TRUNCATE')) {
            errors.push(
              `清空表操作: 子任务 "${子任务.id || 'unknown'}" 试图清空表，此操作不可恢复。请改用 DELETE 并先备份`
            );
          }

          // 导入导出提醒
          if (工具名 === 'mysql_import' || 工具名 === 'mysql_export') {
            warnings.push(
              `数据导入导出: 子任务 "${子任务.id || 'unknown'}" 涉及数据导入/导出，注意文件编码和格式`
            );
          }
        }

        return {
          passed: errors.length === 0,
          warnings,
          errors,
        };
      },
    },
  ],
};
