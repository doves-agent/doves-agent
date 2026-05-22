/**
 * @file 技能分组索引
 * @description KISS 架构：将所有已注册工具按能力分组，LLM 按需获取各组完整 schema
 * 
 * 设计原则：
 * - 系统提示词只注入分组摘要（轻量，约 300 tokens）
 * - LLM 通过「获取能力组」工具按需获取完整工具定义
 * - 分组规则：优先用工具的 category 字段，否则按名称关键词自动分组
 */

import { 创建日志器 } from '@dove/common/日志管理器.js';
import { mcpConnectionManager } from './tools/mcp客户端.js';
import { 获取MCP分组工具 } from './tools/mcp客户端/工具格式转换.js';

const logger = 创建日志器('技能分组索引', { 前缀: '[分组索引]', 级别: 'debug' });

/**
 * 分组映射规则：{ 分组名: [匹配关键词...] }
 * 工具名包含任一关键词即归入该分组
 */
const 分组规则 = {
  '文件操作':     ['代码读取', '代码搜索', '文件搜索', '目录列表', '代码编辑', '代码创建', '符号分析'],
  '系统命令':     ['执行命令', '电源控制', '系统信息', '环境变量', '常用路径', '网络信息', '磁盘信息', '进程列表', '日期时间', '进程查找', '启动进程', '终止进程'],
  'Git版本控制':  ['Git操作', 'Git差异', 'Git溯源', 'Git文件历史', 'Git对比', 'Git统计', 'Git搜索'],
  '网页搜索':     ['网页搜索', '网页抓取'],
  '图像生成':     ['图片', '图像', '生成'],
  '语音合成':     ['语音', '音频', 'TTS', 'ASR'],
  '浏览器控制':   ['键盘', '鼠标', '截图', '窗口', '全屏'],
  '视频处理':     ['视频'],
  '文档处理':     ['文档', 'PDF', 'Excel', 'Word', 'PPT', 'DOC'],
  'MCP外部服务':  ['MCP连接', 'MCP调用', 'MCP列表', 'MCP工具列表', 'MCP断开'],
  '用户交互':     ['询问用户', '通知用户', '进度更新'],
  '数据库':       ['MongoDB', 'MySQL', '数据库', '存储', '查询'],
  '保底工具':     ['日期时间', '网络信息', '查询任务', '关联任务', '发现能力', '通知用户'],
};

/** 工具缓存：懒加载，首次使用时动态 import */
let _所有工具缓存 = null;
let _分组缓存 = null;
let _加载中 = null;

async function _加载工具() {
  if (_所有工具缓存 !== null) return;
  if (_加载中) { await _加载中; return; }

  _加载中 = (async () => {
    try {
      const mod = await import('./tools/index.js');
      _所有工具缓存 = mod.获取所有工具定义();
      logger.debug(`预加载工具总数: ${_所有工具缓存.length}`);
    } catch (e) {
      logger.warn(`无法加载工具定义: ${e.message}`);
      _所有工具缓存 = [];
    } finally {
      _加载中 = null;
    }
  })();

  await _加载中;
}

function _获取所有工具() {
  return _所有工具缓存 || [];
}

/**
 * 按分组规则对所有工具分组
 * @returns {Map<string, Array>} 分组名 → 工具定义数组
 */
async function _建立分组() {
  await _加载工具();

  if (_分组缓存) return _分组缓存;

  const 所有工具 = _获取所有工具();
  const 分组 = new Map();

  // 初始化分组
  for (const 组名 of Object.keys(分组规则)) {
    分组.set(组名, []);
  }

  // 未分组收容
  const 已分配工具名 = new Set();

  for (const 工具 of 所有工具) {
    const 工具名 = 工具.name;
    let 已匹配 = false;

    for (const [组名, 关键词列表] of Object.entries(分组规则)) {
      for (const 关键词 of 关键词列表) {
        if (工具名.includes(关键词)) {
          分组.get(组名).push(_转换为OpenAI格式(工具));
          已分配工具名.add(工具名);
          已匹配 = true;
          break;
        }
      }
      if (已匹配) break;
    }
  }

  // 去重：同一工具可能匹配多个分组，保留首次匹配
  for (const [组名, 工具列表] of 分组) {
    分组.set(组名, _去重工具(工具列表));
  }

  _分组缓存 = 分组;
  logger.debug(`分组完成: ${分组.size} 组`);
  return 分组;
}

/**
 * 将工具定义转换为 OpenAI function-calling 兼容格式
 */
function _转换为OpenAI格式(工具) {
  return {
    type: 'function',
    function: {
      name: 工具.name,
      description: 工具.description || '',
      parameters: 工具.inputSchema || 工具.parameters || { type: 'object', properties: {} },
    },
  };
}

function _去重工具(工具列表) {
  const 已见 = new Set();
  return 工具列表.filter(t => {
    const key = t.function.name;
    if (已见.has(key)) return false;
    已见.add(key);
    return true;
  });
}

// ==================== 对外接口 ====================

/**
 * 获取分组摘要（注入 system prompt，约 300 tokens）
 * @returns {string} 分组摘要文本
 */
export async function 获取分组摘要() {
  const 分组 = await _建立分组();
  const 行 = [];

  for (const [组名, 工具列表] of 分组) {
    if (工具列表.length === 0) continue;
    const 工具名列表 = 工具列表.map(t => t.function.name).join('、');
    行.push(`- ${组名}（${工具列表.length}个工具）：${工具名列表}`);
  }

  // 追加 MCP 动态分组
  const MCP分组名列表 = ['电脑操作', '键盘控制', '鼠标控制', '截图', '窗口管理', '进程管理'];
  for (const 组名 of MCP分组名列表) {
    if (分组.has(组名)) continue;
    const mcp工具 = 获取MCP分组工具(mcpConnectionManager, 组名);
    if (mcp工具.length > 0) {
      const 工具名列表 = mcp工具.map(t => t.function.name).join('、');
      行.push(`- ${组名}（${mcp工具.length}个工具，MCP）：${工具名列表}`);
    }
  }

  return 行.join('\n');
}

/**
 * 获取指定分组的完整工具定义（OpenAI function-calling 格式）
 * 优先查本地分组，若为空则尝试从已连接的 MCP 服务获取
 * @param {string} 分组名 - 分组名称
 * @returns {Array|null} 工具定义数组，或 null（分组不存在）
 */
export async function 获取分组工具定义(分组名) {
  const 分组 = await _建立分组();
  const 工具列表 = 分组.get(分组名);
  if (工具列表 && 工具列表.length > 0) return 工具列表;

  // 本地无匹配，尝试从 MCP 连接动态获取
  const mcp工具 = 获取MCP分组工具(mcpConnectionManager, 分组名);
  if (mcp工具.length > 0) {
    logger.info(`从 MCP 加载分组「${分组名}」: ${mcp工具.length} 个工具`);
    return mcp工具;
  }

  return null;
}

/**
 * 获取所有分组的工具定义（首轮调用时使用，含保底工具）
 * @returns {Array} 工具定义数组
 */
export async function 获取保底工具定义() {
  return (await 获取分组工具定义('保底工具')) || [];
}

/**
 * 获取所有分组名列表
 * @returns {string[]}
 */
export async function 获取所有分组名() {
  const 分组 = await _建立分组();
  return [...分组.keys()].filter(k => 分组.get(k).length > 0);
}

/**
 * 获取所有分组的全部工具定义（去重后）
 * KISS 优化：首轮就把所有工具给 LLM，免去「获取能力组」的额外往返
 * @returns {Array} 工具定义数组（OpenAI function-calling 格式）
 */
export async function 获取所有工具定义() {
  const 分组 = await _建立分组();
  const 所有工具 = [];
  const 已见 = new Set();

  for (const [, 工具列表] of 分组) {
    for (const 工具 of 工具列表) {
      const name = 工具.function?.name || 工具.name;
      if (!已见.has(name)) {
        所有工具.push(工具);
        已见.add(name);
      }
    }
  }

  return 所有工具;
}

/**
 * 清除缓存（扩展包加载后调用以刷新分组）
 */
export function 刷新分组() {
  _所有工具缓存 = null;
  _分组缓存 = null;
}

export default {
  获取分组摘要,
  获取分组工具定义,
  获取保底工具定义,
  获取所有分组名,
  获取所有工具定义,
  刷新分组,
};
