/**
 * 交互式选择工具模块
 * 
 * 统一封装 inquirer 的单选/多选交互，
 * 让 CLI 命令中所有可枚举的字段都走交互式选择，
 * 而非手动输入命令行参数。
 * 
 * 核心原则：
 * - 单选场景：上下箭头选择，回车确认
 * - 多选场景：空格勾选，回车确认
 * - 动态枚举：支持从服务端/运行时获取选项
 * - 静态枚举：直接定义 choices
 */

import inquirer from 'inquirer';
import { PROVIDER_NAME_MAP, normalizeProvider } from '@dove/common/模型配置.js';

/**
 * 单选 - 上下箭头选择，回车确认
 * 
 * @param {string} message - 提示信息
 * @param {Array<{name:string, value:string}>} choices - 选项列表
 * @param {string} [defaultValue] - 默认选中值
 * @returns {Promise<string>} 选中的值
 */
export async function select(message, choices, defaultValue) {
  const { result } = await inquirer.prompt([
    {
      type: 'list',
      name: 'result',
      message,
      choices,
      default: defaultValue,
      pageSize: 15,
    }
  ]);
  return result;
}

/**
 * 多选 - 空格勾选，回车确认
 * 
 * @param {string} message - 提示信息
 * @param {Array<{name:string, value:string, checked?:boolean}>} choices - 选项列表
 * @returns {Promise<string[]>} 选中的值数组
 */
export async function multiSelect(message, choices) {
  const { result } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'result',
      message,
      choices,
      pageSize: 15,
    }
  ]);
  return result;
}

/**
 * 确认 - 是/否选择
 * 
 * @param {string} message - 提示信息
 * @param {boolean} [defaultVal=false] - 默认值
 * @returns {Promise<boolean>}
 */
export async function confirm(message, defaultVal = false) {
  const { result } = await inquirer.prompt([
    {
      type: 'list',
      name: 'result',
      message,
      choices: [
        { name: '✓ 是', value: true },
        { name: '✗ 否', value: false },
      ],
      default: defaultVal ? 0 : 1,
    }
  ]);
  return result;
}

/**
 * 输入 - 当无法枚举时退化为文本输入
 * 
 * @param {string} message - 提示信息
 * @param {string} [defaultValue] - 默认值
 * @returns {Promise<string>}
 */
export async function input(message, defaultValue) {
  const { result } = await inquirer.prompt([
    {
      type: 'input',
      name: 'result',
      message,
      default: defaultValue,
    }
  ]);
  return result;
}

// ==================== 常用枚举定义 ====================

/** 提供商列表 */
export const PROVIDER_CHOICES = [
  { name: '阿里百炼 (百炼)', value: '百炼' },
  { name: 'DeepSeek 官方', value: 'DeepSeek' },
  { name: '智谱 GLM', value: 'GLM' },
];

/** 提供商名称映射 - 从全局唯一配置源导入 */
export { PROVIDER_NAME_MAP, normalizeProvider };

/** 工具安全级别 */
export const TOOL_LEVEL_CHOICES = [
  { name: '安全 - 安全（仅只读工具）', value: '安全' },
  { name: '谨慎 - 谨慎（允许写入操作）', value: '谨慎' },
  { name: '危险 - 危险（允许系统级操作）', value: '危险' },
];

/** 任务状态 */
export const TASK_STATUS_CHOICES = [
  { name: '等待中', value: '等待中' },
  { name: '执行中', value: '执行中' },
  { name: '已完成', value: '已完成' },
  { name: '已完成(部分失败)', value: '已完成(部分失败)' },
  { name: '失败', value: '失败' },
  { name: '已终止', value: '已终止' },
  { name: '已取消', value: '已取消' },
];

/** MCP 类型 */
export const MCP_TYPE_CHOICES = [
  { name: 'stdio - 标准输入输出', value: 'stdio' },
  { name: 'http - HTTP 连接', value: 'http' },
  { name: 'sse - Server-Sent Events', value: 'sse' },
];

/** 鸽子类型 */
export const DOVE_TYPE_CHOICES = [
  { name: 'official - 官方鸽子', value: 'official' },
  { name: 'community - 社区鸽子', value: 'community' },
  { name: 'private - 私有鸽子', value: 'private' },
];

/** 渠道列表 */
export const CHANNEL_CHOICES = [
  { name: 'local - 本地同机', value: 'local' },
  { name: 'remote - 远程异机', value: 'remote' },
  { name: 'wechat - 微信', value: 'wechat' },
  { name: 'dingtalk - 钉钉', value: 'dingtalk' },
  { name: 'feishu - 飞书', value: 'feishu' },
  { name: '_default - 默认', value: '_default' },
];

/** 执行模式 */
export const EXECUTION_MODE_CHOICES = [
  { name: '先规划后执行 - 先拆分再执行', value: '先规划后执行' },
  { name: '边做边规划 - 交替执行', value: '边做边规划' },
  { name: '管线式 - 流水线', value: '管线式' },
  { name: '直接执行 - 直接执行（不拆分）', value: '直接执行' },
  { name: '串行保障 - 串行保障', value: '串行保障' },
];

/** 事件类型 */
export const EVENT_TYPE_CHOICES = [
  { name: '定时 - 定时触发', value: '定时' },
  { name: '数据变更 - 数据变更', value: '数据变更' },
  { name: '语义 - 语义触发', value: '语义' },
  { name: '外部 - 外部触发', value: '外部' },
  { name: '意图驱动 - 意图驱动', value: '意图驱动' },
];

/** 服务类型 */
export const SERVICE_TYPE_CHOICES = [
  { name: 'server - 服务端', value: 'server' },
  { name: 'dove - 鸽子', value: 'dove' },
];

/** 日志模块 */
export const LOG_MODULE_CHOICES = [
  { name: 'server - 服务端日志', value: 'server' },
  { name: 'doves - 鸽群日志', value: 'doves' },
  { name: 'llm - LLM调用日志', value: 'llm' },
];

/** 对话模式 */
export const CHAT_MODE_CHOICES = [
  { name: 'continuous - 持续模式（默认）', value: 'continuous' },
  { name: 'once - 单次模式', value: 'once' },
];

/** 开关选项 */
export const ON_OFF_CHOICES = [
  { name: '开启 (on)', value: 'on' },
  { name: '关闭 (off)', value: 'off' },
];

/** 权限角色 */
export const PERMISSION_ROLE_CHOICES = [
  { name: 'owner - 鸽主权限', value: 'owner' },
  { name: 'granted - 授权权限', value: 'granted' },
];

/** 能力列表（与 doves/常量.js ABILITIES 同步） */
export const ABILITY_CHOICES = [
  { name: '推理', value: '推理' },
  { name: '编程', value: '编程' },
  { name: '创意', value: '创意' },
  { name: '快速', value: '快速' },
  { name: '长文本', value: '长文本' },
  { name: '多模态', value: '多模态' },
  { name: '视觉', value: '视觉' },
  { name: '图片理解', value: '图片理解' },
  { name: '图片生成', value: '图片生成' },
  { name: '视频理解', value: '视频理解' },
  { name: 'OCR', value: 'OCR' },
  { name: '界面理解', value: '界面理解' },
  { name: '工具调用', value: '工具调用' },
  { name: '多语言', value: '多语言' },
  { name: '低成本', value: '低成本' },
  { name: '翻译', value: '翻译' },
  { name: '语音合成', value: '语音合成' },
  { name: '语音识别', value: '语音识别' },
  { name: '向量嵌入', value: '向量嵌入' },
  { name: '数学推理', value: '数学推理' },
  { name: '知识库', value: '知识库' },
];

/** 目录权限位（用于 perm-grant 多选） */
export const PERM_BIT_CHOICES = [
  { name: '查看 (1)', value: 1 },
  { name: '下载 (2)', value: 2 },
  { name: '编辑 (4)', value: 4 },
  { name: '删除 (8)', value: 8 },
  { name: '管理 (16)', value: 16 },
];

/** 规划策略 */
export const PLAN_STRATEGY_CHOICES = [
  { name: '信息聚合 - 信息聚合', value: '信息聚合' },
  { name: '递归问题 - 递归问题', value: '递归问题' },
  { name: '探索调研 - 探索调研', value: '探索调研' },
  { name: '创作管线 - 创作管线', value: '创作管线' },
  { name: '简单执行 - 简单执行', value: '简单执行' },
  { name: '编码任务 - 编码任务', value: '编码任务' },
];

/** 子任务角色 */
export const SUBTASK_ROLE_CHOICES = [
  { name: '信息收集 - 信息收集员', value: '信息收集' },
  { name: '推理分析 - 分析员', value: '推理分析' },
  { name: '聚合汇总 - 整合者', value: '聚合汇总' },
  { name: '验证质控 - 验证员', value: '验证质控' },
  { name: '创作执行 - 执行者', value: '创作执行' },
];

/** 最大并发数（常用值） */
export const MAX_CONCURRENCY_CHOICES = [
  { name: '1 (串行)', value: '1' },
  { name: '3', value: '3' },
  { name: '5 (默认)', value: '5' },
  { name: '10', value: '10' },
  { name: '20', value: '20' },
];

/** 最大拆分深度 */
export const MAX_DEPTH_CHOICES = [
  { name: '0 (不拆分)', value: '0' },
  { name: '1', value: '1' },
  { name: '2', value: '2' },
  { name: '3 (默认)', value: '3' },
  { name: '5 (极限)', value: '5' },
];

/** Profile 标签（常见） */
export const PROFILE_TAG_CHOICES = [
  { name: '通用', value: '通用' },
  { name: '调试', value: '调试' },
  { name: '规划', value: '规划' },
  { name: '爬虫', value: '爬虫' },
  { name: '网络', value: '网络' },
  { name: '编程', value: '编程' },
  { name: 'GUI', value: 'GUI' },
  { name: '自动化', value: '自动化' },
  { name: '串行', value: '串行' },
];

/** 工具模块（常见禁用工具） */
export const TOOL_MODULE_CHOICES = [
  { name: 'system_exec - 系统命令执行', value: 'system_exec' },
  { name: 'system_power - 系统电源操作', value: 'system_power' },
  { name: 'process_terminate - 进程终止', value: 'process_terminate' },
  { name: 'file_delete - 文件删除', value: 'file_delete' },
  { name: 'file_write - 文件写入', value: 'file_write' },
  { name: 'web_fetch - 网页抓取', value: 'web_fetch' },
  { name: 'gui_control - GUI自动化控制', value: 'gui_control' },
  { name: 'image_gen - 图片生成', value: 'image_gen' },
  { name: 'mcp_client - MCP客户端', value: 'mcp_client' },
];

/**
 * 辅助函数：将字符串数组转为 inquirer choices 格式
 * @param {string[]} items - 字符串数组
 * @returns {Array<{name:string, value:string}>}
 */
export function toChoices(items) {
  return items.map(item => ({ name: item, value: item }));
}

/**
 * 辅助函数：将对象映射转为 inquirer choices 格式
 * @param {Object} map - { value: displayName }
 * @returns {Array<{name:string, value:string}>}
 */
export function mapToChoices(map) {
  return Object.entries(map).map(([value, name]) => ({ name, value }));
}

/**
 * 辅助函数：动态获取模型列表作为 choices
 * @param {DoveClient} client
 * @param {string} [provider] - 可选提供商筛选
 * @returns {Promise<Array<{name:string, value:string}>>}
 */
export async function getModelChoices(client, provider) {
  try {
    const data = await client.getModelList(provider);
    const choices = [];
    
    if (provider && data.models) {
      // 单个提供商
      let index = 1;
      for (const m of data.models) {
        choices.push({
          name: `${index}. ${m.name} ${m.category ? `(${m.category})` : ''}`,
          value: m.name,
        });
        index++;
      }
    } else if (data.providers) {
      // 所有提供商
      let index = 1;
      for (const [prov, models] of Object.entries(data.providers)) {
        for (const m of models) {
          choices.push({
            name: `${index}. [${prov}] ${m.name} ${m.category ? `(${m.category})` : ''}`,
            value: `${prov}:${m.name}`,
          });
          index++;
        }
      }
    }
    
    if (choices.length === 0) {
      choices.push({ name: '(暂无模型，请先执行 dove model refresh)', value: '__none__' });
    }
    
    return choices;
  } catch (err) {
    return [{ name: '(获取模型列表失败，请手动输入)', value: '__manual__' }];
  }
}

/**
 * 辅助函数：从 "provider:model" 格式解析
 * @param {string} selected - 如 "百炼:qwen3.6-plus"
 * @returns {{provider:string, model:string}}
 */
export function parseModelSelection(selected) {
  if (selected.includes(':')) {
    const [provider, model] = selected.split(':');
    return { provider, model };
  }
  return { model: selected, provider: null };
}

/**
 * 辅助函数：交互式选择模型（先选提供商，再选模型）
 * @param {DoveClient} client
 * @param {string} [defaultProvider] - 默认提供商
 * @returns {Promise<{provider:string, model:string}|null>}
 */
export async function selectModel(client, defaultProvider) {
  // 先选提供商
  const provider = await select('选择提供商', PROVIDER_CHOICES, defaultProvider);
  if (!provider) return null;
  
  // 获取该提供商的模型列表
  const modelChoices = await getModelChoices(client, provider);
  
  if (modelChoices.length === 1 && modelChoices[0].value === '__none__') {
    // 没有模型，手动输入
    const model = await input('输入模型名称');
    return { provider, model };
  }
  
  // 选择模型
  const selected = await select('选择模型', modelChoices);
  
  if (selected === '__manual__') {
    const model = await input('输入模型名称');
    return { provider, model };
  }
  
  return parseModelSelection(selected);
}

export default {
  select,
  multiSelect,
  confirm,
  input,
  selectModel,
  getModelChoices,
  toChoices,
  mapToChoices,
  parseModelSelection,
  PROVIDER_CHOICES,
  TOOL_LEVEL_CHOICES,
  TASK_STATUS_CHOICES,
  MCP_TYPE_CHOICES,
  DOVE_TYPE_CHOICES,
  CHANNEL_CHOICES,
  EXECUTION_MODE_CHOICES,
  EVENT_TYPE_CHOICES,
  SERVICE_TYPE_CHOICES,
  LOG_MODULE_CHOICES,
  CHAT_MODE_CHOICES,
  ON_OFF_CHOICES,
  PERMISSION_ROLE_CHOICES,
  ABILITY_CHOICES,
  PERM_BIT_CHOICES,
  PLAN_STRATEGY_CHOICES,
  SUBTASK_ROLE_CHOICES,
  MAX_CONCURRENCY_CHOICES,
  MAX_DEPTH_CHOICES,
  PROFILE_TAG_CHOICES,
  TOOL_MODULE_CHOICES,
};
