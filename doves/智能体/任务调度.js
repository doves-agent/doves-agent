import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('任务调度', { 前缀: '[智能体]', 级别: 'debug', 显示调用位置: true });

export function mixin任务调度(instance) {
  //
  // 从任务队列获取任务
  // 委托给任务执行器
  instance.抢任务 = async function() {
    return await this.task执行器.抢任务();
  }

  //
  // 执行任务
  // 委托给任务执行器
  instance.执行任务 = async function(任务) {
    return await this.task执行器.执行任务(任务);
  }

  
  //
  // 启动任务执行循环
  // 核心稳定性设计：
  // 1. 整个循环包裹在 try-catch 中，任何异常都不会杀死循环
  // 2. 任务执行失败后自动恢复状态为"空闲"，继续接下一个任务
  // 3. 每次循环都有独立的错误处理，互不影响
  // 4. 连续出错时增加轮询间隔，避免空转消耗资源
  // 5. 支持通过 AbortController 中断正在执行的任务
  instance.启动 = async function() {
    this.运行中 = true;
    let 连续出错次数 = 0;  // 追踪连续错误，动态调整轮询间隔
    let 连续空转次数 = 0;  // 追踪连续无任务空转，用于动态轮询间隔
    
    logger.info(`→ 启动任务循环: 鸽子=${this.名称}, ID=${this.ID}`);
    
    // 启动监工
    this.监工.启动(this);
    
    // 轮询循环
    while (this.运行中) {
      try {
        if (this.可接受任务()) {
          const 任务 = await this.抢任务();
          if (任务) {
            连续出错次数 = 0;  // 成功抢到任务，重置错误计数
            连续空转次数 = 0;  // 重置空转计数
            const 执行t0 = Date.now();
            logger.info(`抢到任务: ID=${任务.任务ID}, 类型=${任务.类型 || 任务.任务类型 || '未知'}, 描述=${(任务.描述 || 任务.description || '').substring(0, 60)}`);
            try {
              // 每次执行任务时创建新的 AbortController
              this.abortController = new AbortController();
              await this.执行任务(任务);
              logger.info(`任务完成: ID=${任务.任务ID} (${Date.now() - 执行t0}ms)`);
            } catch (执行错误) {
              // 被中断的任务不当作失败处理
              if (执行错误.name === 'AbortError' || 执行错误.message?.includes('中止')) {
                                logger.info('任务被中止（正常停止流程）');
              } else {
                // 任务执行异常 — 记录错误但不要死，恢复状态继续
                                logger.error(`任务执行异常: ${执行错误.message}`);
                // 尝试重试任务（可重试错误放回队列，不可重试标FAILED）
                try {
                  const taskId = 任务.任务ID;
                  if (taskId) {
                    await this.任务队列.重试任务(taskId, 执行错误);
                  }
                } catch (重试错误) {
                                    logger.error(`重试任务也失败: ${重试错误.message}`);
                }
              }
              // 确保鸽子状态恢复为空闲（防止卡在忙碌状态）
              this.当前任务 = null;
              this.abortController = null;
              await this.切换状态('在线');
            }
          } else {
            // 没有任务可抢，正常情况
            连续出错次数 = 0;
            连续空转次数++;
          }
        }
        
        // 动态轮询间隔：空闲时1秒快速轮询，连续空转10次后退避到3秒
        const 轮询间隔 = 连续空转次数 < 10 ? 1000 : 3000;
        await new Promise(resolve => setTimeout(resolve, 轮询间隔));
        
      } catch (循环错误) {
        // 循环级别的异常（抢任务失败、数据库断连等）
        连续出错次数++;
                logger.error(`任务循环异常(连续第${连续出错次数}次): ${循环错误.message}`);
        
        // 确保状态恢复
        this.当前任务 = null;
        this.abortController = null;
        await this.切换状态('在线');
        
        // 动态退避：连续出错越多，等待越久
        const 基础退避 = 5000 * Math.pow(2, 连续出错次数 - 1);
        const 抖动 = 基础退避 * Math.random() * 0.5;
        const 退避时间 = Math.min(基础退避 + 抖动, 60000);
                logger.warn(`等待 ${(退避时间/1000).toFixed(1)}s 后继续轮询...`);
        await new Promise(resolve => setTimeout(resolve, 退避时间));
      }
    }
    
        logger.info('任务循环已退出');
  }

  //
  // 停止智能体
  // 设计原则：
  // 1. 立即中断正在执行的任务（通过 AbortController）
  // 2. 将当前任务释放回队列（ready状态），让其他鸽子可以重新领取
  // 3. 更新鸽子状态为离线
  // 4. 超时保护：如果优雅停止超时，强制退出循环
  instance.停止 = async function() {
    logger.info(`→ 停止: 鸽子=${this.名称}, 当前任务=${this.当前任务?.任务ID || '无'}`);
    this.运行中 = false;
    
    // 1. 中断正在执行的任务（通过 AbortController）
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    // 2. 停止监工
    this.监工.停止();
    
    // 3. 批量释放该鸽子的所有 running 任务（含当前任务 + 残留）
    //    设计上允许崩溃重启后继续未完成任务，不需要先保存再释放
    //    重启时回收未完成任务机制会把这些任务重新领回执行
    this.当前任务 = null;
    if (this.任务队列 && this.ID) {
      try {
        const 释放数 = await this.任务队列.释放鸽子任务(this.ID, '鸽子停止，释放任务回队列');
        if (释放数 > 0) {
                    logger.info(`已释放 ${释放数} 个任务回队列`);
        }
      } catch (批量释放错误) {
                logger.warn(`批量释放失败: ${批量释放错误.message}`);
      }
    }

    // 4. 更新状态为离线（fire-and-forget，不阻塞退出）
    this.状态 = '离线';
    this.更新鸽子身份状态('离线').catch(() => {});
  }

  
  //
  // 回收上次未完成的任务
  // 鸽子重启时，检查数据库中是否有上次该鸽子 ID 正在执行但未完成的任务
  // 将这些任务释放回 ready 状态，这样它们可以重新被领取
  // 
  // 设计原则：
  // - 鸽子有唯一 ID，重启后身份一致
  // - 同一机器启动的鸽子和实例有不同 index（实例标识不同）
  // - 所以重启后可以安全地查询上次自己未完成的任务并释放
  instance.回收未完成任务 = async function() {
    const _t0 = Date.now();
    if (!this.任务队列 || !this.ID) {
      logger.debug('跳过回收未完成任务: 任务队列或ID未就绪');
      return;
    }
    
    // 使用 DovesProxy（服务端模式）时，鸽群管理器已统一调用 releaseStaleTasks 清理残留任务
    // 此处跳过，避免用内存ID查询导致清理无效（内存ID与服务端 doveId 不一致）
    if (this.DovesProxy || this.使用服务端模式) {
      logger.debug(`回收跳过: 使用服务端模式 (${Date.now() - _t0}ms)`);
      return;
    }
    
    try {
      // 查询上次该鸽子 ID 正在执行但未完成的任务
      const 未完成任务 = await this.任务队列.查询鸽子任务(this.ID);
      
      if (未完成任务.length === 0) {
        return;
      }
      
            logger.info(`发现 ${未完成任务.length} 个上次未完成任务，释放回队列...`);
      
      // 批量释放所有未完成的任务
      const 释放数 = await this.任务队列.释放鸽子任务(this.ID, '鸽子重启，回收上次未完成任务');
      logger.info(`已释放 ${释放数} 个未完成任务 (${Date.now() - _t0}ms)`);
    } catch (错误) {
      // 回收失败不影响启动
            logger.warn(`回收未完成任务失败: ${错误.message}`);
    }
  }

  //
  // 检查是否空闲可以接受新任务
  instance.可接受任务 = function() {
    return this.运行中 && this.状态 === '在线' && this.当前任务 === null;
  }
  
  //
  // 获取当前状态
  instance.获取状态 = function() {
    return this.状态;
  }
  
  //
  // 是否正在执行任务
  instance.是否忙碌 = function() {
    return this.状态 === '忙碌' || this.当前任务 !== null;
  }
  

}
