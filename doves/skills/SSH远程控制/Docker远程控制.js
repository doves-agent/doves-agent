/**
 * Docker 远程控制
 * 从 ssh_agent/index.js 提取
 */

import { executeCommand, logger } from './SSH连接管理.js';

/**
 * 检查远程 Docker 是否可用
 */
export async function handleDockerCheck(params) {
  const { host } = params;
  
  if (!host) {
    return { success: false, error: '缺少主机配置' };
  }
  
  try {
    const result = await executeCommand({
      host,
      command: 'docker version --format "{{.Server.Version}}"',
      timeout: 10000
    });
    
    if (result.success && result.stdout.trim()) {
      return {
        success: true,
        available: true,
        version: result.stdout.trim()
      };
    }
    
    return {
      success: true,
      available: false,
      message: 'Docker 未安装或不可用'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 列出远程 Docker 镜像
 */
export async function handleDockerListImages(params) {
  const { host } = params;
  
  if (!host) {
    return { success: false, error: '缺少主机配置' };
  }
  
  try {
    const result = await executeCommand({
      host,
      command: 'docker images --format "{{.Repository}}:{{.Tag}}\\t{{.ID}}\\t{{.Size}}"',
      timeout: 30000
    });
    
    if (!result.success) {
      return result;
    }
    
    const images = result.stdout.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [name, id, size] = line.split('\t');
        return { name, id, size };
      });
    
    return { success: true, images };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 列出远程 Docker 容器
 */
export async function handleDockerListContainers(params) {
  const { host, all = false } = params;
  
  if (!host) {
    return { success: false, error: '缺少主机配置' };
  }
  
  try {
    const allFlag = all ? '-a' : '';
    const result = await executeCommand({
      host,
      command: `docker ps ${allFlag} --format "{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"`,
      timeout: 30000
    });
    
    if (!result.success) {
      return result;
    }
    
    const containers = result.stdout.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [name, image, status, ports] = line.split('\t');
        return { name, image, status, ports };
      });
    
    return { success: true, containers };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 运行远程 Docker 容器
 */
export async function handleDockerRun(params) {
  const { host, container, timeout = 120000 } = params;
  
  if (!host || !container?.image) {
    return { success: false, error: '缺少主机配置或镜像名称' };
  }
  
  try {
    let command = 'docker run -d';
    
    if (container.name) {
      command += ` --name ${container.name}`;
    }
    
    if (container.env) {
      for (const [key, value] of Object.entries(container.env)) {
        command += ` -e ${key}="${value}"`;
      }
    }
    
    if (container.ports) {
      for (const port of container.ports) {
        command += ` -p ${port}`;
      }
    }
    
    if (container.volumes) {
      for (const [hostPath, containerPath] of Object.entries(container.volumes)) {
        command += ` -v ${hostPath}:${containerPath}`;
      }
    }
    
    command += ` ${container.image}`;
    
    if (container.cmd) {
      command += ` ${container.cmd}`;
    }
    
    logger.info(`远程运行容器: ${container.name || container.image}`);
    
    const result = await executeCommand({ host, command, timeout });
    
    if (result.success) {
      const containerId = result.stdout.trim().substring(0, 12);
      return {
        success: true,
        containerId,
        name: container.name,
        message: '容器已启动'
      };
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 停止远程 Docker 容器
 */
export async function handleDockerStop(params) {
  const { host, containerName } = params;
  
  if (!host || !containerName) {
    return { success: false, error: '缺少主机配置或容器名称' };
  }
  
  try {
    const result = await executeCommand({
      host,
      command: `docker stop ${containerName}`,
      timeout: 30000
    });
    
    if (result.success) {
      return { success: true, containerName, message: '容器已停止' };
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 在远程容器中执行命令
 */
export async function handleDockerExec(params) {
  const { host, containerName, cmd, timeout = 60000 } = params;
  
  if (!host || !containerName || !cmd) {
    return { success: false, error: '缺少必要参数' };
  }
  
  try {
    const result = await executeCommand({
      host,
      command: `docker exec ${containerName} ${cmd}`,
      timeout
    });
    
    return {
      success: result.success,
      output: result.stdout,
      error: result.stderr || result.error
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 获取远程容器日志
 */
export async function handleDockerLogs(params) {
  const { host, containerName, tail = 100 } = params;
  
  if (!host || !containerName) {
    return { success: false, error: '缺少主机配置或容器名称' };
  }
  
  try {
    const result = await executeCommand({
      host,
      command: `docker logs --tail ${tail} ${containerName}`,
      timeout: 30000
    });
    
    return {
      success: result.success,
      logs: result.stdout || result.stderr
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
