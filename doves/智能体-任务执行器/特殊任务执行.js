/**
 * @file 特殊任务执行
 * @description 任务执行器的特殊任务执行模块
 * 
 * 包含：事件LLM判断任务、扩展工具任务、MCP运维任务、技能任务
 */

import { 任务状态 } from '../常量.js';
import { 处理工具调用 } from '../tools/index.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('特殊任务', { 前缀: '[特殊任务]', 级别: 'debug', 显示调用位置: true });

/**
 * 执行事件调度LLM判断任务
 * Server 创建 event_llm_judge 类型任务，Doves 自主拉取执行
 * 
 * @param {Object} 执行器 - 任务执行器实例
 * @param {Object} 任务 - 任务对象
 * @returns {Object} 执行结果
 */
export async function 执行事件LLM判断任务(执行器, 任务) {
  const _t0 = Date.now();
  const taskId = 任务.任务ID;
  const llmRequest = 任务.LLM请求 || {};
  const { 提示词, temperature = 0.1, max_tokens = 500, label = '事件调度LLM' } = llmRequest;

  if (!提示词) {
    throw new Error('event_llm_judge 任务缺少提示词');
  }

  logger.info(`→ 执行事件LLM判断: ${label}`);

  try {
    // 使用 llmCaller 调用 LLM
    // 描述用 label 做进度条标签（避免 prompt 全文刷屏），prompt 只在 messages 中发送一次
    const llmResult = await 执行器.智能体.llmCaller.调用(
      { 描述: label || '事件LLM判断', 提示词, 用户ID: 任务.用户ID, 任务ID: taskId },
      [],
      { temperature, maxTokens: max_tokens, 提供商: 执行器.智能体.快速提供商 || 执行器.智能体.默认提供商 }
    );

    if (!llmResult.成功) {
      throw new Error(llmResult.错误 || 'LLM调用失败');
    }

    // 解析 JSON 结果
    let parsedResult;
    const content = llmResult.内容 || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsedResult = JSON.parse(jsonMatch[0]);
      } catch (e) {
        parsedResult = { raw: content };
      }
    } else {
      parsedResult = { raw: content };
    }

    // 提交结果
    await 执行器.智能体.任务队列.提交结果(taskId, JSON.stringify(parsedResult), true);

    执行器.智能体.当前任务 = null;
    await 执行器.智能体.切换状态('在线');

    return { 成功: true, 数据: parsedResult };
  } catch (错误) {
    logger.error(`← 事件LLM判断失败: ${错误.message} (${Date.now() - _t0}ms)`);

    await 执行器.智能体.任务队列.提交结果(taskId, null, false, 错误.message);

    执行器.智能体.当前任务 = null;
    await 执行器.智能体.切换状态('在线');

    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 执行扩展工具调用任务
 * Server 创建 extension_tool 类型任务，Doves 自主拉取执行
 * 
 * @param {Object} 执行器 - 任务执行器实例
 * @param {Object} 任务 - 任务对象
 * @returns {Object} 执行结果
 */
export async function 执行扩展工具任务(执行器, 任务) {
  const _t0 = Date.now();
  const taskId = 任务.任务ID;
  const { name: toolName, extension, args, safetyLevel } = 任务.扩展工具 || {};

  if (!toolName) {
    throw new Error('扩展工具任务缺少工具名称');
  }

  logger.info(`→ 执行扩展工具: ${toolName} (来自 ${extension || '未知扩展'})`);

  const 开始时间 = Date.now();

  try {
    // 调用工具处理系统（已内置扩展工具路由 + LLM 上下文注入）
    const 工具结果 = await 处理工具调用(toolName, args || {});

    const 耗时 = Date.now() - 开始时间;

    // 统一结果格式
    let 提交结果;
    if (工具结果?.isError) {
      // 工具执行出错
      const 错误信息 = typeof 工具结果.content?.[0]?.text === 'string'
        ? 工具结果.content[0].text
        : '扩展工具执行失败';
      提交结果 = { 成功: false, 错误: 错误信息, 执行耗时: 耗时 };
    } else {
      // 提取内容
      let 内容 = '';
      if (Array.isArray(工具结果?.content)) {
        内容 = 工具结果.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n');
      } else if (typeof 工具结果 === 'string') {
        内容 = 工具结果;
      } else if (工具结果) {
        内容 = JSON.stringify(工具结果);
      }
      提交结果 = { 成功: true, 数据: 工具结果, 回复: 内容, 执行耗时: 耗时 };
    }

    // 提交结果到任务队列
    await 执行器.智能体.任务队列.提交结果(
      taskId,
      提交结果.回复 || JSON.stringify(提交结果),
      提交结果.成功,
      提交结果.成功 ? undefined : 提交结果.错误
    );

    // 补充执行耗时到任务
    await 执行器.智能体.任务队列.更新状态(taskId, 提交结果.成功 ? 任务状态.COMPLETED : 任务状态.FAILED, {
      执行耗时: 耗时,
    }).catch(e => logger.warn(`更新扩展工具任务耗时失败: ${e.message}`));

    执行器.智能体.当前任务 = null;
    await 执行器.智能体.切换状态('在线');

    return 提交结果;
  } catch (错误) {
    const 耗时 = Date.now() - 开始时间;
    logger.error(`← 扩展工具失败: ${toolName}, ${错误.message} (${Date.now() - _t0}ms)`);

    // 提交失败结果
    await 执行器.智能体.任务队列.提交结果(taskId, null, false, 错误.message);

    执行器.智能体.当前任务 = null;
    await 执行器.智能体.切换状态('在线');

    return { 成功: false, 错误: 错误.message, 执行耗时: 耗时 };
  }
}

/**
 * 执行 MCP 运维任务（连接测试 / 能力刷新）
 * Server 创建 mcp_test / mcp_refresh 类型任务，Doves 自主拉取执行
 * 
 * @param {Object} 执行器 - 任务执行器实例
 * @param {Object} 任务 - 任务对象
 * @returns {Object} 执行结果
 */
export async function 执行MCP运维任务(执行器, 任务) {
  const _t0 = Date.now();
  const taskId = 任务.任务ID;
  const taskType = 任务.类型;
  const mcpData = 任务.MCP || {};

  logger.info(`→ 执行MCP运维任务: ${taskType}`);

  // 动态导入 MCP配置管理器（仅在需要时加载）
  const { MCP配置管理器 } = await import('../MCP配置管理器.js');
  const 管理器 = new MCP配置管理器();

  try {
    if (taskType === 'mcp_test') {
      // 单个 MCP Server 连接测试
      const { serverConfig } = mcpData;
      if (!serverConfig) {
        throw new Error('MCP测试任务缺少服务器配置');
      }

      const 测试结果 = await 管理器.测试连接(serverConfig);

      // 通过 Server API 更新数据库中的连接状态
      if (执行器.智能体.DovesProxy) {
        try {
          await 执行器.智能体.DovesProxy.fetch('/api/dove/admin/鸽子身份/updateOne', {
            method: 'POST',
            body: {
              filter: { 鸽子ID: mcpData.doveId, 'MCP配置.servers.名称': serverConfig.名称 },
              update: {
                $set: {
                  'MCP配置.servers.$.连接状态': 测试结果.success ? 'connected' : 'error',
                  'MCP配置.servers.$.工具列表': 测试结果.tools || [],
                  'MCP配置.servers.$.错误信息': 测试结果.error || null,
                },
              },
            },
          });
        } catch (e) {
          logger.warn(`更新MCP连接状态失败: ${e.message}`);
        }
      }

      const 结果 = {
        成功: 测试结果.success,
        数据: {
          名称: serverConfig.名称,
          连接状态: 测试结果.success ? 'connected' : 'error',
          工具数量: 测试结果.toolCount || 0,
          工具列表: 测试结果.tools || [],
          错误: 测试结果.error || null,
        },
      };

      await 执行器.智能体.任务队列.提交结果(
        taskId,
        JSON.stringify(结果.数据),
        结果.成功,
        结果.成功 ? undefined : 结果.数据.错误
      );

      执行器.智能体.当前任务 = null;
      await 执行器.智能体.切换状态('在线');
      return 结果;
    }

    if (taskType === 'mcp_refresh') {
      // 刷新所有 MCP Server 能力发现
      const { servers = [] } = mcpData;
      let 刷新数量 = 0;
      let 成功数量 = 0;
      const 工具汇总 = [];

      for (const server of servers) {
        if (!server.启用) continue;

        刷新数量++;
        const 测试结果 = await 管理器.测试连接(server);

        if (测试结果.success) {
          成功数量++;
          工具汇总.push({ 名称: server.名称, 工具列表: 测试结果.tools });
        }

        // 通过 Server API 更新连接状态
        if (执行器.智能体.DovesProxy) {
          try {
            await 执行器.智能体.DovesProxy.fetch('/api/dove/admin/鸽子身份/updateOne', {
              method: 'POST',
              body: {
                filter: { 鸽子ID: mcpData.doveId, 'MCP配置.servers.名称': server.名称 },
                update: {
                  $set: {
                    'MCP配置.servers.$.连接状态': 测试结果.success ? 'connected' : 'error',
                    'MCP配置.servers.$.工具列表': 测试结果.tools || [],
                    'MCP配置.servers.$.错误信息': 测试结果.error || null,
                  },
                },
              },
            });
          } catch (e) {
            logger.warn(`更新MCP连接状态失败 (${server.名称}): ${e.message}`);
          }
        }
      }

      const 结果 = {
        成功: true,
        数据: { 刷新数量, 成功数量, 工具汇总 },
      };

      await 执行器.智能体.任务队列.提交结果(taskId, JSON.stringify(结果.数据), true);

      执行器.智能体.当前任务 = null;
      await 执行器.智能体.切换状态('在线');
      return 结果;
    }

    throw new Error(`未知的MCP运维任务类型: ${taskType}`);
  } catch (错误) {
    logger.error(`← MCP运维任务失败: ${taskType}, ${错误.message} (${Date.now() - _t0}ms)`);

    await 执行器.智能体.任务队列.提交结果(taskId, null, false, 错误.message);

    执行器.智能体.当前任务 = null;
    await 执行器.智能体.切换状态('在线');

    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 执行技能任务
 * @param {Object} 执行器 - 任务执行器实例
 * @param {Object} 任务 - 任务对象
 * @returns {Object} 执行结果
 */
export async function 执行技能任务(执行器, 任务) {
  const _t0 = Date.now();
  const taskId = 任务.任务ID;
  logger.info(`→ 执行技能任务: ${任务.type}`);

  const 技能名 = 任务.type;
  const 技能 = 执行器.智能体.技能管理器.已注册技能.get(技能名);

  if (!技能) {
    throw new Error(`技能 ${技能名} 未注册`);
  }

  try {
    // 构建技能参数
    const 技能参数 = {
      targetUserId: 任务.targetUserId || 任务.allocation?.userId,
      allocation: 任务.allocation,
      ...任务.参数
    };

    // 构建执行上下文
    const 上下文 = {
      数据库连接: 执行器.智能体.数据库连接,
      数据库名: 执行器.智能体.数据库名,
      用户数据库名: 执行器.智能体.用户数据库名,
      鸽子ID: 执行器.智能体.ID,
      任务ID: taskId,
      keyManager: 执行器.智能体.keyManager,
      系统配置: 执行器.智能体.系统配置,
      userId: 任务.用户ID,
      userRole: 任务.用户角色 || 任务.userRole || 'user',  // 用户角色，用于权限验证
      userData: 任务.userData || { 拥有技能: 任务.拥有技能 || [] },  // 用户数据，包含拥有的技能
      // IM 上下文：从任务中注入，让技能感知 IM 平台信息
      imContext: 任务.IM上下文 || null,
    };

    // 执行技能
    const 结果 = await 技能.execute(技能参数, 上下文);

    // 提交结果（通过 Server API）
    if (结果.成功) {
      await 执行器.智能体.任务队列.提交结果(taskId, 结果, true);
    } else {
      await 执行器.智能体.任务队列.提交结果(taskId, null, false, 结果.错误 || '技能执行失败');
    }

    执行器.智能体.当前任务 = null;
    await 执行器.智能体.切换状态('在线');

    return 结果;

  } catch (错误) {
    logger.error(`← 技能任务失败: ${技能名}, ${错误.message} (${Date.now() - _t0}ms)`);
    try {
      // 优先尝试重试（可重试错误放回队列）
      await 执行器.智能体.任务队列.重试任务(taskId, 错误);
    } catch (重试错误) {
      logger.error(`重试技能任务失败: ${重试错误.message}`);
    }
    执行器.智能体.当前任务 = null;
    await 执行器.智能体.切换状态('在线');
    // 技能任务失败不向上抛出，让循环继续
    return { 成功: false, 错误: 错误.message };
  }
}
