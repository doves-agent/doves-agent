/**
 * SSH 文件传输 (SFTP)
 * 从 ssh_agent/index.js 提取
 */

import { getSSHConnection, logger } from './SSH连接管理.js';

/**
 * 获取 SFTP 会话
 */
export async function getSFTP(host) {
  const connectResult = await getSSHConnection(host);
  if (!connectResult.success) {
    return connectResult;
  }
  
  return new Promise((resolve, reject) => {
    connectResult.client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(`SFTP 会话创建失败: ${err.message}`));
      } else {
        resolve({ success: true, sftp });
      }
    });
  });
}

/**
 * 上传文件到远程主机
 */
export async function uploadFile(params) {
  const { host, localPath, remotePath, mode } = params;
  
  if (!host || !localPath || !remotePath) {
    return { success: false, error: '缺少必要参数' };
  }
  
  try {
    const sftpResult = await getSFTP(host);
    if (!sftpResult.success) {
      return sftpResult;
    }
    
    const sftp = sftpResult.sftp;
    
    return new Promise((resolve) => {
      sftp.fastPut(localPath, remotePath, { mode }, (err) => {
        if (err) {
          resolve({ success: false, error: `上传失败: ${err.message}` });
        } else {
          logger.info(`文件已上传: ${localPath} -> ${remotePath}`);
          resolve({ success: true, localPath, remotePath });
        }
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 从远程主机下载文件
 */
export async function downloadFile(params) {
  const { host, remotePath, localPath } = params;
  
  if (!host || !remotePath || !localPath) {
    return { success: false, error: '缺少必要参数' };
  }
  
  try {
    const sftpResult = await getSFTP(host);
    if (!sftpResult.success) {
      return sftpResult;
    }
    
    const sftp = sftpResult.sftp;
    const fs = await import('fs');
    const path = await import('path');
    
    // 确保本地目录存在
    const localDir = path.dirname(localPath);
    await fs.promises.mkdir(localDir, { recursive: true });
    
    return new Promise((resolve) => {
      sftp.fastGet(remotePath, localPath, (err) => {
        if (err) {
          resolve({ success: false, error: `下载失败: ${err.message}` });
        } else {
          logger.info(`文件已下载: ${remotePath} -> ${localPath}`);
          resolve({ success: true, remotePath, localPath });
        }
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 列出远程目录内容
 */
export async function listRemoteDir(params) {
  const { host, remotePath } = params;
  
  if (!host || !remotePath) {
    return { success: false, error: '缺少必要参数' };
  }
  
  try {
    const sftpResult = await getSFTP(host);
    if (!sftpResult.success) {
      return sftpResult;
    }
    
    const sftp = sftpResult.sftp;
    
    return new Promise((resolve) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          resolve({ success: false, error: `读取目录失败: ${err.message}` });
        } else {
          const files = list.map(item => ({
            name: item.filename,
            type: item.attrs.isDirectory() ? 'directory' : 'file',
            size: item.attrs.size,
            mode: item.attrs.mode,
            modifyTime: item.attrs.mtime
          }));
          resolve({ success: true, path: remotePath, files });
        }
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 创建远程目录
 */
export async function createRemoteDir(params) {
  const { host, remotePath } = params;
  
  if (!host || !remotePath) {
    return { success: false, error: '缺少必要参数' };
  }
  
  try {
    const sftpResult = await getSFTP(host);
    if (!sftpResult.success) {
      return sftpResult;
    }
    
    const sftp = sftpResult.sftp;
    
    return new Promise((resolve) => {
      sftp.mkdir(remotePath, err => {
        if (err) {
          resolve({ success: false, error: `创建目录失败: ${err.message}` });
        } else {
          resolve({ success: true, path: remotePath });
        }
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 删除远程文件或目录
 */
export async function removeRemote(params) {
  const { host, remotePath, recursive = false } = params;
  
  if (!host || !remotePath) {
    return { success: false, error: '缺少必要参数' };
  }
  
  try {
    const sftpResult = await getSFTP(host);
    if (!sftpResult.success) {
      return sftpResult;
    }
    
    const sftp = sftpResult.sftp;
    
    // 检查是文件还是目录
    const statResult = await new Promise((resolve) => {
      sftp.stat(remotePath, (err, stats) => {
        resolve({ err, stats });
      });
    });
    
    if (statResult.err) {
      return { success: false, error: `文件不存在: ${remotePath}` };
    }
    
    return new Promise((resolve) => {
      if (statResult.stats.isDirectory()) {
        if (!recursive) {
          resolve({ success: false, error: '删除目录需要 recursive=true' });
          return;
        }
        sftp.rmdir(remotePath, err => {
          if (err) {
            resolve({ success: false, error: `删除目录失败: ${err.message}` });
          } else {
            resolve({ success: true, path: remotePath });
          }
        });
      } else {
        sftp.unlink(remotePath, err => {
          if (err) {
            resolve({ success: false, error: `删除文件失败: ${err.message}` });
          } else {
            resolve({ success: true, path: remotePath });
          }
        });
      }
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}
