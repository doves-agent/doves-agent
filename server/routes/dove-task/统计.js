/**
 * 鸽子统计计算模块
 * 职责：重新计算鸽子的成功率、平均耗时等衍生统计字段
 * 
 * 从 server/routes/dove-task.js 拆分，遵循KISS原则
 */

/**
 * 重新计算鸽子统计衍生字段（成功率 + 平均耗时）
 * 在每次任务完成/放弃/超时后调用
 */
export async function 重新计算鸽子统计(adminDb, doveId, 本次耗时) {
  const 鸽子 = await adminDb.collection('鸽子身份').findOne(
    { 鸽子ID: doveId },
    { projection: { 统计: 1 } }
  );
  if (!鸽子?.统计) return;
  
  const s = 鸽子.统计;
  const 完成 = s.完成任务数 || 0;
  const 失败 = s.失败任务数 || 0;
  const 放弃 = s.放弃任务数 || 0;
  const 超时 = s.超时任务数 || 0;
  const 总数 = 完成 + 失败 + 放弃 + 超时;
  
  const 成功率 = 总数 > 0 ? Math.round(完成 / 总数 * 10000) / 10000 : 0;
  
  let 平均耗时 = s.平均耗时 || 0;
  if (本次耗时 > 0) {
    if (完成 > 1) {
      平均耗时 = Math.round((平均耗时 * (完成 - 1) + 本次耗时) / 完成);
    } else {
      平均耗时 = 本次耗时;
    }
  }
  
  await adminDb.collection('鸽子身份').updateOne(
    { 鸽子ID: doveId },
    { $set: { '统计.成功率': 成功率, '统计.平均耗时': 平均耗时 } }
  );
}
