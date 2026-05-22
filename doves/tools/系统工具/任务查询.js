/**
 * @file tools/系统工具/任务查询
 * @description 任务查询工具：通过任务ID查询任务详情、列出关联任务
 */

const text = (content) => ({ content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }] });

// 任务数据库引用
let taskDbRef = null;
let taskDbNameRef = null;

export function setTaskDbConnection(db, dbName) {
  taskDbRef = db;
  taskDbNameRef = dbName || 'doves_user_data';
}

export async function handleTaskQuery(args) {
  if (!taskDbRef) {
    return text({ error: '任务数据库未连接，无法查询任务信息' });
  }
  
  const taskId = args.task_id;
  if (!taskId) {
    return text({ error: '请提供 task_id 参数' });
  }
  
  try {
    const db = taskDbRef.db(taskDbNameRef);
    const task = await db.collection('任务').findOne({ 任务ID: taskId });
    
    if (!task) {
      return text({ error: `未找到任务: ${taskId}` });
    }
    
    const taskInfo = {
      任务ID: task.任务ID,
      类型: task.类型,
      状态: task.状态,
      描述: task.描述 || task.用户消息 || '',
      技能: task.技能 || task.skill || '',
      结果: task.结果 || null,
      错误: task.错误 || null,
      父任务ID: task.父任务ID || null,
      依赖: task.依赖 || [],
      创建时间: task.创建时间 || null,
      完成时间: task.完成时间 || null
    };
    
    return text(taskInfo);
  } catch (err) {
    return text({ error: `查询任务失败: ${err.message}` });
  }
}

export async function handleTaskListRelated(args) {
  if (!taskDbRef) {
    return text({ error: '任务数据库未连接，无法查询任务列表' });
  }
  
  const parentTaskId = args.parent_task_id;
  if (!parentTaskId) {
    return text({ error: '请提供 parent_task_id 参数' });
  }
  
  try {
    const db = taskDbRef.db(taskDbNameRef);
    let query = { 父任务ID: parentTaskId };
    
    if (args.status_filter) {
      const statusMap = {
        '已完成': '已完成',
        '失败': '失败',
        '执行中': '执行中',
        '等待中': '等待中'
      };
      const statusValue = statusMap[args.status_filter] || args.status_filter;
      query.状态 = statusValue;
    }
    
    const subTasks = await db.collection('任务')
      .find(query)
      .project({ 任务ID: 1, 类型: 1, 状态: 1, 描述: 1, 技能: 1, 依赖: 1, 创建时间: 1 })
      .sort({ 创建时间戳: 1 })
      .toArray();
    
    if (subTasks.length === 0) {
      return text({ message: `未找到父任务 ${parentTaskId} 下的子任务`, parentTaskId, subTaskCount: 0 });
    }
    
    const result = {
      parentTaskId,
      subTaskCount: subTasks.length,
      subTasks: subTasks.map(t => ({
        任务ID: t.任务ID,
        状态: t.状态,
        描述: t.描述 || '',
        技能: t.技能 || '',
        依赖: t.依赖 || []
      }))
    };
    
    return text(result);
  } catch (err) {
    return text({ error: `查询相关任务失败: ${err.message}` });
  }
}
