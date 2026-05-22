/**
 * @file 入口-启动器
 * @description 鸽群启动器和认证模块
 * 
 * 包含：创建鸽子、启动服务、获取鸽子认证凭证、命令行参数解析
 */

import { 智能体 } from './智能体.js';
import { 获取或生成机器标识 } from '@dove/common/机器标识.js';
import { DovesProxy } from './doves_proxy/index.js';
import { DoveCryptoClient } from './加密客户端.js';
import { waitForServer } from '@dove/common/服务器等待工具.js';
import { 记录服务端地址 } from './utils/启动汇总.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';
import { DEFAULT_PORT } from '@dove/common/crypto/protocol.js';

const logger = 创建日志器('入口', { 前缀: '[入口]', 级别: 'debug', 显示调用位置: true });

/**
 * 创建并启动一个鸽子实例（单个鸽子快速入口）
 * @param {Object} 配置 - 鸽子配置
 * @returns {Promise<智能体>} 鸽子实例
 */
export async function 创建鸽子(配置 = {}) {
  logger.info(`创建鸽子实例: ${配置.名称 || '未命名'}`);

  const 鸽子 = new 智能体(配置);
  await 鸽子.初始化();

  // 如果配置中有自动启动，则启动
  if (配置.自动启动) {
    await 鸽子.启动();
  }

  return 鸽子;
}

/**
 * 启动鸽子服务（完整服务入口）
 * @param {Object} 配置 - 服务配置
 * @param {DoveCryptoClient} 配置.加密客户端 - 已连接的加密客户端
 * @returns {Promise<Object>} 服务实例
 */
export async function 启动服务(配置 = {}) {
  logger.info('服务启动中...');

  const serverUrl = process.env.SERVER_URL || 'http://0.0.0.0:3003';
  const 加密客户端 = 配置.加密客户端;

  if (!加密客户端?.connected) {
    throw new Error('加密客户端未连接，无法启动服务');
  }

  const dovesProxy = new DovesProxy({
    cryptoClient: 加密客户端,
    serverUrl
  });

  // 验证连接（通过加密通道）
  const health = await dovesProxy.healthCheck();
  if (!health.success) {
    logger.warn('服务端连接失败:', health.error);
  }

  logger.info('初始化鸽群...');

  // 动态导入避免循环依赖
  const { 创建鸽群 } = await import('./入口.js');
  const 鸽群 = 创建鸽群({ 最大实例数: 配置.并发数 || 5 });
  鸽群.服务端代理 = dovesProxy;
  鸽群.批量创建鸽子(配置.鸽子数量 || 5, 配置.鸽子配置);

  await 鸽群.启动全部();

  // 关闭状态标记，防止重复关闭
  let 已关闭 = false;

  // 优雅关闭处理
  const 优雅关闭 = async () => {
    if (已关闭) {
      logger.info('服务已关闭，跳过重复关闭请求');
      return;
    }
    已关闭 = true;

    logger.info('收到关闭信号，正在关闭...');

    // 设置强制退出超时：8 秒后如果还没关闭完，强制退出
    const forceExitTimer = setTimeout(() => {
      logger.error('关闭超时(8s)，强制退出！');
      process.exit(1);
    }, 8000);

    try {
      await 鸽群.停止全部();
    } catch (错误) {
        logger.error('停止鸽群失败:', 错误.message);
    }

    // 关闭鸽子代理（清理缓存）
    try {
      dovesProxy.close();
    } catch (e) {
      logger.warn(`关闭鸽子代理失败: ${e.message}`);
    }
    logger.info('鸽子代理已清理');

    // 关闭加密连接
    try {
      加密客户端.close();
    } catch (e) {
      logger.warn(`关闭加密连接失败: ${e.message}`);
    }

    clearTimeout(forceExitTimer);
    logger.info('服务已停止');
    process.exit(0);
  };

  process.on('SIGTERM', 优雅关闭);
  process.on('SIGINT', 优雅关闭);

  return {
    状态: '运行中',
    实例ID: 'dove_service_' + Date.now(),
    鸽群,
    dovesProxy,
    加密客户端,
    关闭: async () => {
      if (已关闭) {
        logger.info('服务已关闭，跳过重复关闭请求');
        return;
      }
      已关闭 = true;

      await 鸽群.停止全部();

      // 关闭鸽子代理
      dovesProxy.close();
      // 关闭加密连接
      加密客户端.close();
    }
  };
}

/**
 * 通过加密通道获取鸽子认证凭证
 *
 * 鸽子进程与 Server 进程完全分离，通过加密 TCP 通道通信：
 * 1. 如果 SERVER_API_KEY 已设置 → 直接使用（手动配置模式）
 * 2. 如果 GATEWAY_JWT 已设置 → 通过加密通道注册/恢复鸽子身份，获取 apiKey
 * 3. 都没有 → 报错退出
 *
 * @param {string} serverUrl - 服务端地址（用于提取 hostname）
 * @returns {Promise<string|null>} apiKey
 */
export async function 获取鸽子认证凭证(serverUrl) {
  // 路径1：已手动配置 apiKey，直接使用
  if (process.env.SERVER_API_KEY) {
    logger.info('使用已有的 SERVER_API_KEY');
    return process.env.SERVER_API_KEY;
  }

  // 路径2：通过 GATEWAY_JWT 调用加密通道注册 API
  const gatewayJwt = process.env.GATEWAY_JWT;
  if (!gatewayJwt) {
    logger.error('错误：需要 GATEWAY_JWT 或 SERVER_API_KEY 环境变量来认证鸽子');
    logger.error('GATEWAY_JWT 用于通过加密通道注册/恢复鸽子身份');
    logger.error('SERVER_API_KEY 用于直接使用已有密钥');
    return null;
  }

  const machineId = 获取或生成机器标识();
  logger.info(`机器标识: ${machineId}`);

  // 创建临时加密连接用于注册（无 apiKey，Noise NX 握手本身不需要预认证）
  const hostname = new URL(serverUrl).hostname;
  const tempClient = new DoveCryptoClient({
    hostname,
    machineId,
    apiKey: gatewayJwt  // 用 GATEWAY_JWT 作为认证凭据
  });

  try {
    await tempClient.connect();
    logger.info('注册用加密通道已建立');

    // 先查找已有身份，优先匹配当前机器前缀的鸽子
    const findResult = await tempClient.request('GET', '/api/dove/my-doves', {
      apiKey: gatewayJwt
    });
    const findData = findResult?.data || findResult;

    if (findData?.success && findData?.data?.length > 0) {
      const 匹配鸽子 = findData.data.find(d => {
        const doveId = d.doveId || d.鸽子ID || '';
        return doveId && doveId.startsWith(machineId + '_');
      });

      if (匹配鸽子) {
        const 目标ID = 匹配鸽子.doveId || 匹配鸽子.鸽子ID;
        logger.info(`发现已有鸽子: ${目标ID} (当前机器匹配)`);

        // 重新生成 API 密钥
        const regenResult = await tempClient.request('POST', `/api/dove/${目标ID}/regenerate-key`, {
          apiKey: gatewayJwt
        });
        const regenData = regenResult?.data || regenResult;

        if (regenData?.success && regenData?.data?.apiKey) {
          tempClient.close();
          return regenData.data.apiKey;
        }
        logger.warn(`重新生成API密钥失败: ${regenData?.error || '未知'}`);
      } else {
        logger.info(`未找到当前机器(${machineId})的已有鸽子，注册新鸽子`);
      }
    }

    // 注册新鸽子
    const regResult = await tempClient.request('POST', '/api/dove/register', {
      名称: `系统鸽子_${machineId}`,
      类型: 'official',
      能力列表: [],
      machineId,
      apiKey: gatewayJwt
    });
    const regData = regResult?.data || regResult;

    if (regData?.success && regData?.data?.apiKey) {
      logger.info(`注册新鸽子: ${regData.data.doveId}`);
      tempClient.close();
      return regData.data.apiKey;
    }

    logger.error(`注册鸽子失败: ${regData?.error || '未知'}`);
    tempClient.close();
    return null;
  } catch (e) {
    logger.error(`加密通道注册失败: ${e.message}`);
    logger.error('请确保 Server 已启动且加密端口可达');
    try { tempClient.close(); } catch (_) {}
    return null;
  }
}

/**
 * 命令行参数解析
 * @returns {Object} 启动配置
 */
export function 解析参数() {
  const args = process.argv.slice(2);
  const 配置 = {
    并发数: 1,
    鸽子数量: 1,
    鸽子配置: { 自动启动: true }
  };

  for (const arg of args) {
    if (arg.startsWith('--doves=') || arg.startsWith('-d=')) {
      配置.鸽子数量 = parseInt(arg.split('=')[1]) || 1;
      配置.并发数 = 配置.鸽子数量;
    } else if (arg === '--doves' || arg === '-d') {
      // 下一个参数是数量
      const idx = args.indexOf(arg);
      if (idx + 1 < args.length && !args[idx + 1].startsWith('-')) {
        配置.鸽子数量 = parseInt(args[idx + 1]) || 1;
        配置.并发数 = 配置.鸽子数量;
      }
    } else if (arg.startsWith('--concurrency=')) {
      配置.并发数 = parseInt(arg.split('=')[1]) || 1;
    } else if (arg === '--debug') {
      // 调试模式：日志附带可点击的调用位置链接
      process.env.DOVE_DEBUG = '1';
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法: node doves/入口.js [选项]');
      console.log('');
      console.log('选项:');
      console.log('  --doves=N, -d N     鸽子数量（默认: 1）');
      console.log('  --concurrency=N     并发数（默认: 与鸽子数量相同）');
      console.log('  --debug             调试模式（日志附带可点击的调用位置链接）');
      console.log('  --wait              等待服务端上线（定时重试，不退出）');
      console.log('  --help, -h          显示帮助');
      console.log('');
      console.log('环境变量:');
      console.log('  SERVER_URL          服务端地址（必需）');
      console.log('  GATEWAY_JWT         管理员JWT（用于自动注册鸽子身份）');
      console.log('  SERVER_API_KEY      鸽子API密钥（直接使用，跳过注册）');
      process.exit(0);
    }
  }

  return 配置;
}

/**
 * 命令行直接运行入口
 * 当 `node doves/入口.js` 直接运行时调用
 */
export async function 启动命令行入口() {
  const 启动配置 = 解析参数();
  const 等待模式 = process.argv.includes('--wait');

  // 确定服务端地址
  const serverUrl = process.env.SERVER_URL || 'http://0.0.0.0:3003';
  process.env.SERVER_URL = serverUrl;
  记录服务端地址(serverUrl);
  logger.info(`服务端地址: ${serverUrl}`);

  // 定义完整启动流程
  const 完整启动 = async () => {
    // 第一阶段：通过加密通道注册获取认证凭证
    const doveApiKey = await 获取鸽子认证凭证(serverUrl);
    if (!doveApiKey) {
      throw new Error('无法获取鸽子认证凭证');
    }
    process.env.SERVER_API_KEY = doveApiKey;
    delete process.env.SERVER_JWT;

    // 第二阶段：建立加密 TCP 连接
    const machineId = 获取或生成机器标识();
    const hostname = new URL(serverUrl).hostname;
    logger.info(`建立加密连接: ${hostname}:${DEFAULT_PORT.ENCRYPTED} (机器: ${machineId})`);

    const 加密客户端 = new DoveCryptoClient({
      hostname,
      machineId,
      apiKey: doveApiKey
    });

    try {
      await 加密客户端.connect();
      logger.info('加密通道已建立');
    } catch (err) {
      throw new Error(`加密连接失败: ${err.message}`);
    }

    // 第三阶段：通过加密通道启动服务
    await 启动服务({ ...启动配置, 加密客户端 });
  };

  if (等待模式) {
    // 等待服务端上线：通过 TCP 连接尝试探测加密端口是否可达
    const hostname = new URL(serverUrl).hostname;
    const port = DEFAULT_PORT.ENCRYPTED;
    const 连接测试 = async () => {
      try {
        const { createConnection } = await import('net');
        return new Promise((resolve) => {
          const sock = createConnection(port, hostname, () => {
            sock.destroy();
            resolve(true);
          });
          sock.on('error', () => resolve(false));
          sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
        });
      } catch (e) {
        logger.debug(`连接测试失败: ${e.message}`);
        return false;
      }
    };

    try {
      await waitForServer(连接测试, {
        日志前缀: '[入口]',
        重试间隔: 5000,
        成功回调: 完整启动,
      });
    } catch (err) {
      logger.error('启动失败:', err);
      process.exit(1);
    }
  } else {
    try {
      await 完整启动();
    } catch (err) {
      logger.error('启动失败:', err);
      process.exit(1);
    }
  }
}
