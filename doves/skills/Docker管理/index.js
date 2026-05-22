/**
 * Docker 容器管理技能
 * 
 * 功能：
 * - 列出镜像/容器
 * - 创建/启动/停止/删除容器
 * - 在容器中执行命令
 * - 查看容器日志和状态
 * - 闪切模式：创建→执行→自动释放
 * 
 * 设计原则：
 * - 参数自包含，不依赖外部上下文
 * - 无状态执行，支持并发调用
 * - 所有命令异步执行，不阻塞事件循环
 * - 参数转义防注入
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import { 创建日志器 } from '@dove/common/日志管理器.js';

// ============================================================================
// 日志器
// ============================================================================

const logger = 创建日志器('Docker管理', { 前缀: '[Docker管理]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 安全配置
// ============================================================================

const CONFIG = {
  // 默认超时
  defaultTimeout: 60000,
  // 最大超时
  maxTimeout: 300000,
  // 执行命令最大超时
  execTimeout: 300000,
  // 默认内存限制
  defaultMemory: '512m',
  // 默认 CPU 配额（微秒/100ms）
  defaultCpuQuota: 50000,
  // 容器名前缀
  namePrefix: 'dove_flash_',
};

/**
 * 安全转义 shell 参数
 * @param {string} str - 要转义的字符串
 * @returns {string} 转义后的字符串
 */
function shellEscape(str) {
  if (typeof str !== 'string') return String(str);
  // 用单引号包裹，内部单引号替换为 '\''
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * 安全执行 docker 命令
 * @param {string} args - docker 子命令和参数
 * @param {object} options - 执行选项
 * @returns {Promise<{成功: boolean, 输出?: string, 错误?: string}>}
 */
async function dockerExec(args, options = {}) {
  const timeout = Math.min(options.timeout || CONFIG.defaultTimeout, CONFIG.maxTimeout);
  const cmd = `docker ${args}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      encoding: 'utf-8',
      timeout,
      cwd: options.cwd || process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // docker 有时把正常输出写到 stderr（如 progress），只有非零退出码才算失败
    return {
      成功: true,
      输出: (stdout || '').trim(),
      标准错误: (stderr || '').trim()
    };
  } catch (error) {
    const output = error.stdout?.trim() || '';
    const errText = error.stderr?.trim() || error.message;

    // 超时
    if (error.killed) {
      return { 成功: false, 错误: `命令超时 (${timeout}ms)` };
    }

    return { 成功: false, 错误: errText, 输出: output };
  }
}

// ============================================================================
// 操作实现
// ============================================================================

/**
 * 列出可用镜像
 */
async function listImages() {
  const result = await dockerExec(
    'images --format "{{.Repository}}:{{.Tag}}\\t{{.ID}}\\t{{.Size}}"'
  );

  if (!result.成功) return result;

  const images = result.输出.split('\n').filter(Boolean).map(line => {
    const [name, id, size] = line.split('\t');
    return { name, id, size };
  });

  return { 成功: true, 数据: { images, count: images.length } };
}

/**
 * 列出容器
 */
async function listContainers(all = false) {
  const allFlag = all ? '-a' : '';
  const result = await dockerExec(
    `ps ${allFlag} --format "{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.ID}}"`
  );

  if (!result.成功) return result;

  const containers = result.输出.split('\n').filter(Boolean).map(line => {
    const [name, image, status, ports, id] = line.split('\t');
    return { name, image, status, ports, id };
  });

  return { 成功: true, 数据: { containers, count: containers.length } };
}

/**
 * 创建并启动容器
 */
async function createContainer(params) {
  const {
    image = 'node:18',
    name,
    mounts = [],
    env = {},
    memory = CONFIG.defaultMemory,
    cpuQuota = CONFIG.defaultCpuQuota,
    ports = [],
    workdir,
    cmd
  } = params;

  // 生成容器名（防止冲突）
  const containerName = name || `${CONFIG.namePrefix}${Date.now()}`;

  // 构建参数
  const parts = ['run -d'];

  parts.push(`--name ${shellEscape(containerName)}`);
  parts.push(`--memory=${shellEscape(memory)}`);
  parts.push(`--cpu-quota=${cpuQuota}`);

  // 挂载卷
  for (const m of mounts) {
    if (m.source && m.target) {
      parts.push(`-v ${shellEscape(m.source)}:${shellEscape(m.target)}`);
    }
  }

  // 环境变量
  for (const [k, v] of Object.entries(env)) {
    parts.push(`-e ${shellEscape(k)}=${shellEscape(String(v))}`);
  }

  // 端口映射
  for (const p of ports) {
    parts.push(`-p ${shellEscape(String(p))}`);
  }

  // 工作目录
  if (workdir) {
    parts.push(`-w ${shellEscape(workdir)}`);
  }

  // 镜像
  parts.push(shellEscape(image));

  // 容器内保持运行
  parts.push('tail -f /dev/null');

  const result = await dockerExec(parts.join(' '));

  if (!result.成功) {
    return { 成功: false, 错误: result.错误 };
  }

  return {
    成功: true,
    数据: {
      containerId: result.输出.substring(0, 12),
      containerName,
      image,
      status: '执行中'
    }
  };
}

/**
 * 在容器中执行命令
 */
async function execInContainer(params) {
  const { container, command, timeout = CONFIG.execTimeout, user } = params;

  if (!container || !command) {
    return { 成功: false, 错误: '缺少必填参数: container 和 command' };
  }

  let args = `exec`;
  if (user) args += ` --user ${shellEscape(user)}`;
  args += ` ${shellEscape(container)} ${command}`;

  // exec 不受 docker 命令超时控制，靠子进程超时
  const result = await dockerExec(args, { timeout });

  if (!result.成功) {
    return { 成功: false, 错误: result.错误 };
  }

  return {
    成功: true,
    数据: {
      container,
      输出: result.输出,
      标准错误: result.标准错误 || ''
    }
  };
}

/**
 * 查看容器日志
 */
async function containerLogs(params) {
  const { container, tail = 100, since, follow = false } = params;

  if (!container) {
    return { 成功: false, 错误: '缺少必填参数: container' };
  }

  let args = `logs --tail ${tail}`;
  if (since) args += ` --since ${shellEscape(since)}`;
  args += ` ${shellEscape(container)}`;

  const result = await dockerExec(args);

  if (!result.成功) {
    return { 成功: false, 错误: result.错误 };
  }

  return {
    成功: true,
    数据: {
      container,
      logs: result.输出 || result.标准错误 || ''
    }
  };
}

/**
 * 查看容器状态
 */
async function containerStatus(params) {
  const { container } = params;

  if (!container) {
    return { 成功: false, 错误: '缺少必填参数: container' };
  }

  const result = await dockerExec(
    `inspect --format '{{.State.Status}}|{{.State.Running}}|{{.State.ExitCode}}|{{.State.StartedAt}}|{{.NetworkSettings.IPAddress}}' ${shellEscape(container)}`
  );

  if (!result.成功) {
    return { 成功: false, 错误: result.错误 };
  }

  const [status, running, exitCode, startedAt, ipAddress] = result.输出.split('|');

  return {
    成功: true,
    数据: {
      container,
      status: status?.trim() || 'unknown',
      running: running?.trim() === 'true',
      exitCode: exitCode?.trim() || '',
      startedAt: startedAt?.trim() || '',
      ipAddress: ipAddress?.trim() || ''
    }
  };
}

/**
 * 停止容器
 */
async function stopContainer(params) {
  const { container, time = 10 } = params;

  if (!container) {
    return { 成功: false, 错误: '缺少必填参数: container' };
  }

  const result = await dockerExec(`stop -t ${time} ${shellEscape(container)}`);

  if (!result.成功) {
    return { 成功: false, 错误: result.错误 };
  }

  return { 成功: true, 数据: { container, status: 'stopped' } };
}

/**
 * 删除容器（先停止再删除）
 */
async function removeContainer(params) {
  const { container, force = false } = params;

  if (!container) {
    return { 成功: false, 错误: '缺少必填参数: container' };
  }

  // 先尝试停止
  if (!force) {
    await dockerExec(`stop ${shellEscape(container)}`);
  }

  const rmFlag = force ? '-f' : '';
  const result = await dockerExec(`rm ${rmFlag} ${shellEscape(container)}`);

  if (!result.成功) {
    return { 成功: false, 错误: result.错误 };
  }

  return { 成功: true, 数据: { container, status: 'removed' } };
}

/**
 * 闪切模式：创建→执行→自动删除
 */
async function flashRun(params) {
  const { image = 'node:18', command, memory, timeout = CONFIG.execTimeout } = params;

  if (!command) {
    return { 成功: false, 错误: '闪切模式需要 command 参数' };
  }

  // 1. 创建容器
  const createResult = await createContainer({
    image,
    memory: memory || CONFIG.defaultMemory,
  });

  if (!createResult.成功) {
    return createResult;
  }

  const containerName = createResult.数据.containerName;

  try {
    // 2. 执行命令
    const execResult = await execInContainer({
      container: containerName,
      command,
      timeout
    });

    return {
      成功: execResult.成功,
      数据: {
        ...execResult.数据,
        container: containerName,
        image,
        flashMode: true
      },
      错误: execResult.错误
    };
  } finally {
    // 3. 无论成败都清理容器
    await removeContainer({ container: containerName, force: true });
  }
}

// ============================================================================
// 主执行函数
// ============================================================================

async function execute(args, context) {
  const { action } = args;

  if (!action) {
    return { 成功: false, 错误: '缺少必填参数: action' };
  }

  logger.info(`执行: ${action}`);

  try {
    switch (action) {
      case 'list_images':
        return await listImages();

      case 'list_containers':
        return await listContainers(args.all);

      case 'create':
        return await createContainer(args);

      case 'exec':
        return await execInContainer(args);

      case 'logs':
        return await containerLogs(args);

      case 'status':
        return await containerStatus(args);

      case 'stop':
        return await stopContainer(args);

      case 'remove':
        return await removeContainer(args);

      case 'flash_run':
        return await flashRun(args);

      default:
        return { 成功: false, 错误: `未知操作: ${action}` };
    }
  } catch (error) {
    logger.error(`执行 ${action} 失败:`, error.message);
    return { 成功: false, 错误: error.message, 错误码: 'EXECUTION_ERROR' };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: 'Docker管理',
  description: 'Docker 容器管理技能 - 镜像/容器列表、创建/启动/停止/删除容器、容器内执行命令、查看日志和状态、闪切模式（创建→执行→自动释放）',

  // 内置技能，不需要拥有权检查
  需要拥有权: false,

  // 能力声明
  abilities: ['Docker', '容器管理', '闪切', '环境隔离'],

  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list_images', 'list_containers', 'create', 'exec', 'logs', 'status', 'stop', 'remove', 'flash_run'],
        description: '操作类型：list_images(镜像列表)、list_containers(容器列表)、create(创建容器)、exec(容器内执行)、logs(查看日志)、status(容器状态)、stop(停止)、remove(删除)、flash_run(闪切：创建→执行→自动删除)'
      },
      // create / flash_run 参数
      image: {
        type: 'string',
        default: 'node:18',
        description: 'Docker 镜像名'
      },
      name: {
        type: 'string',
        description: '容器名称（可选，不指定则自动生成）'
      },
      mounts: {
        type: 'array',
        description: '挂载卷列表 [{source, target}]',
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '宿主机路径' },
            target: { type: 'string', description: '容器内路径' }
          }
        }
      },
      env: {
        type: 'object',
        description: '环境变量 { KEY: "VALUE" }'
      },
      memory: {
        type: 'string',
        default: '512m',
        description: '内存限制（如 512m、1g）'
      },
      cpuQuota: {
        type: 'integer',
        default: 50000,
        description: 'CPU 配额（微秒/100ms，50000=50%）'
      },
      ports: {
        type: 'array',
        description: '端口映射列表（如 ["8080:80"]）',
        items: { type: 'string' }
      },
      workdir: {
        type: 'string',
        description: '容器内工作目录'
      },
      // exec / flash_run 参数
      container: {
        type: 'string',
        description: '容器名称或ID（exec/logs/status/stop/remove 时必填）'
      },
      command: {
        type: 'string',
        description: '要执行的命令（exec/flash_run 时必填）'
      },
      user: {
        type: 'string',
        description: '执行命令的用户（exec 时可选）'
      },
      // logs 参数
      tail: {
        type: 'integer',
        default: 100,
        description: '日志行数（logs 操作）'
      },
      since: {
        type: 'string',
        description: '日志起始时间（logs 操作，如 "1h"）'
      },
      // remove 参数
      force: {
        type: 'boolean',
        default: false,
        description: '强制删除（remove 操作）'
      },
      // list_containers 参数
      all: {
        type: 'boolean',
        default: false,
        description: '列出所有容器（包括停止的）'
      }
    },
    required: ['action']
  },

  execute
};
