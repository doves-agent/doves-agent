/**
 * API 路由公共辅助函数
 * 职责：字段映射（中文 MongoDB 字段 → CLI 期望的英文字段）
 */

/**
 * 映射结果对象内部的字段
 */
export function mapResultFields(result) {
  if (!result) return result;
  
  // 处理 flashResponse
  const mapped = { ...result };
  
  // 映射成功标志
  if (result.成功 !== undefined) mapped.success = result.成功;
  
  // 映射 flashResponse 或 routing 结果
  if (result.flashResponse) {
    mapped.flashResponse = {
      ...result.flashResponse,
      success: result.flashResponse.成功,
      content: result.flashResponse.内容
    };
  }
  
  // 映射 routing 对象
  if (result.routing) {
    mapped.routing = {
      ...result.routing,
      category: result.routing.category,
      complexity: result.routing.complexity,
      canFlashReply: result.routing.canFlashReply,
      flashResponse: result.routing.flashResponse ? {
        ...result.routing.flashResponse,
        success: result.routing.flashResponse.成功,
        content: result.routing.flashResponse.内容
      } : undefined
    };
  }
  
  // 映射分支任务ID
  if (result.branchTaskId) mapped.branchTaskId = result.branchTaskId;
  
  return mapped;
}

/**
 * 字段映射：将中文 MongoDB 字段转换为 CLI 期望的英文字段
 */
export function mapTaskFields(task) {
  if (!task) return task;
  
  return {
    // 基础字段
    _id: task._id,
    id: task.任务ID,
    description: task.描述,
    status: task.状态,
    phase: task.阶段,
    type: task.类型,
    
    // 关联字段
    conversationId: task.对话ID,
    rootTaskId: task.根任务ID,
    parentTaskId: task.父任务ID,
    userId: task.用户ID,
    
    // 流式内容
    streamBuffer: task.流缓冲 || [],
    
    // 结果和错误
    result: mapResultFields(task.结果),
    error: task.错误,
    
    // 子任务
    children: task.子任务列表 || [],
    childrenStatus: task.子任务状态,
    
    // 执行信息
    assignedTo: task.执行者,
    provider: task.执行提供商,
    heartbeatAt: task.心跳时间,
    
    // 时间
    createdAt: task.创建时间,
    createdAtTs: task.创建时间戳,
    updatedAt: task.updatedAt,
    updatedAtTs: task.updatedAtTs,
    completedAt: task.completedAt,
    
    // 机器亲和调度
    machineId: task.machineId,
    localAffinity: task.机器亲和 || false,
    
    // 原始数据（保留所有原始字段，防止遗漏）
    ...task
  };
}
