/**
 * @file tools/系统工具
 * @description 系统信息、环境变量、命令执行、进程管理与任务查询
 */

import { systemTools } from './系统工具/工具定义.js';
import { handleSystemInfo, handleSystemEnv, handleSystemPaths, handleSystemNetwork, handleSystemExec, handleSystemDiskUsage, handleSystemProcesses, handleSystemDatetime } from './系统工具/系统信息.js';
import { setTaskDbConnection, handleTaskQuery, handleTaskListRelated } from './系统工具/任务查询.js';
import { setSkillIndexRef, handleDiscoverCapabilities } from './系统工具/能力发现.js';
import { handleSystemPower } from './系统工具/电源管理.js';

// 工具处理路由函数
export async function handleSystemTool(name, args) {
  switch (name) {
    case '系统信息': return handleSystemInfo();
    case '环境变量': return handleSystemEnv(args);
    case '常用路径': return handleSystemPaths();
    case '网络信息': return handleSystemNetwork();
    case '执行命令': return handleSystemExec(args);
    case '磁盘信息': return handleSystemDiskUsage(args);
    case '进程列表': return handleSystemProcesses(args);
    case '日期时间': return handleSystemDatetime(args);
    case '查询任务': return handleTaskQuery(args);
    case '关联任务': return handleTaskListRelated(args);
    case '发现能力': return handleDiscoverCapabilities(args);
    case '电源控制': return handleSystemPower(args);
    default:
      return { content: [{ type: 'text', text: `Unknown system tool: ${name}` }], isError: true };
  }
}

export { systemTools, setTaskDbConnection, setSkillIndexRef };

// 默认导出
export default {
  systemTools,
  handleSystemTool,
  setTaskDbConnection
};
