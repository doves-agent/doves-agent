/**
 * @file 服务器等待工具
 * @description 当服务端不可达时，支持定期重试连接而不退出进程
 * 
 * 使用方式：
 *   import { waitForServer } from '../common/服务器等待工具.js';
 *   await waitForServer(async () => {
 *     // 尝试连接服务器的逻辑，成功返回 truthy，失败抛出异常或返回 falsy
 *     return await someClient.ping();
 *   }, { 日志前缀: '[CLI]', 重试间隔: 5000 });
 */

/**
 * 等待服务端就绪（定时重试）
 * 
 * @param {Function} 连接操作 - 异步函数，返回 truthy 表示成功，falsy 或抛异常表示失败
 * @param {Object} 选项
 * @param {string} 选项.日志前缀 - 日志前缀，默认 '[等待服务端]'
 * @param {number} 选项.重试间隔 - 重试间隔（毫秒），默认 5000
 * @param {number} 选项.最大重试次数 - 最大重试次数，默认 Infinity（无限重试）
 * @param {Function} 选项.成功回调 - 连接成功后回调（可选）
 * @returns {Promise<void>} 连接成功后 resolve，永不 reject（除非触发 SIGINT）
 */
export async function waitForServer(连接操作, 选项 = {}) {
  const {
    日志前缀 = '[等待服务端]',
    重试间隔 = 5000,
    最大重试次数 = Infinity,
    成功回调 = null,
  } = 选项;

  let 重试次数 = 0;
  let 已连接 = false;
  let 收到退出信号 = false;

  // 处理 SIGINT / SIGTERM：标记退出（不直接 exit，让调用方的 handler 处理）
  const 标记退出 = () => {
    if (!已连接 && !收到退出信号) {
      收到退出信号 = true;
      console.log(`\n${日志前缀} 收到退出信号，停止等待`);
    }
  };
  process.on('SIGINT', 标记退出);
  process.on('SIGTERM', 标记退出);

  while (!已连接 && !收到退出信号 && 重试次数 < 最大重试次数) {
    重试次数++;

    try {
      const 结果 = await 连接操作();

      if (结果) {
        已连接 = true;
        console.log(`${日志前缀} 服务端已连接！`);

        // 清理信号处理器
        process.removeListener('SIGINT', 标记退出);
        process.removeListener('SIGTERM', 标记退出);

        if (成功回调) {
          await 成功回调();
        }
        return;
      }
    } catch (e) {
      // 连接失败，继续重试
      console.warn(`${日志前缀} 连接失败 (第 ${重试次数} 次):`, e.message);
    }

    if (!收到退出信号) {
      if (重试次数 === 1) {
        console.log(`${日志前缀} 服务端未就绪，将定时重试（间隔 ${重试间隔 / 1000}s）...`);
      }

      console.log(`${日志前缀} 等待服务端上线... (第 ${重试次数} 次重试)`);

      // 等待指定间隔
      await new Promise(resolve => setTimeout(resolve, 重试间隔));
    }
  }

  // 收到退出信号
  if (收到退出信号) {
    process.exit(1);
  }

  // 达到最大重试次数
  if (!已连接) {
    console.error(`${日志前缀} 已达到最大重试次数（${最大重试次数}），退出`);
    process.exit(1);
  }
}

export default waitForServer;
