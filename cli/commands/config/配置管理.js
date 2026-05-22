/**
 * 配置管理 - get/set/list/reset 及对话设置
 */

import { display } from '../../display.js';
import { loadConfig, saveConfig, resetConfig as resetConfigModule, deleteConfigKeys, DEFAULT_CONFIG } from '../../lib/config.js';
import { 对话日志 } from '../../lib/chat-logger.js';
import { input, select, multiSelect, CHAT_MODE_CHOICES, ON_OFF_CHOICES } from '../../lib/interactive.js';

export async function setConfig(key, value) {
  if (!key) {
    display.error('用法: dove config set <key> <value>');
    display.info('常用配置项:');
    console.log('  server     默认服务端地址');
    console.log('  timeout     请求超时时间(ms)');
    return;
  }
  
  if (value === undefined) {
    display.error('用法: dove config set <key> <value>');
    return;
  }
  
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
  
  display.success(`已设置: ${key} = ${value}`);
}

// 获取配置
export async function getConfig(key) {
  if (!key) {
    display.error('用法: dove config get <key>');
    return;
  }
  
  const config = loadConfig();
  
  if (config[key] !== undefined) {
    console.log(config[key]);
  } else if (DEFAULT_CONFIG[key] !== undefined) {
    console.log(DEFAULT_CONFIG[key]);
    display.info('(默认值)');
  } else {
    display.warn(`配置项不存在: ${key}`);
  }
}

// 列出所有配置
export async function listConfig() {
  const config = loadConfig();
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  display.title('当前配置');
  console.log('');
  console.log(` 配置文件: ${CONFIG_FILE}`);
  console.log('');
  console.log(' ┌─────────────────────────────────────────────────┐');
  
  Object.entries(mergedConfig).forEach(([key, value]) => {
    // 隐藏敏感信息
    if ((key.includes('secret') || key.toLowerCase().includes('password')) && typeof value === 'string') {
      value = '***';
    }
    // 对象类型格式化显示
    if (typeof value === 'object' && value !== null) {
      value = JSON.stringify(value);
    }
    const isDefault = DEFAULT_CONFIG[key] === value && !config[key];
    const marker = isDefault ? ' (默认)' : '';
    console.log(` │ ${key.padEnd(12)} ${String(value).padEnd(30)}${marker.padEnd(8)}│`);
  });
  
  console.log(' └─────────────────────────────────────────────────┘');
  console.log('');
  display.info('使用 dove config set <key> <value> 修改配置');
}

// 重置配置
export async function resetConfig() {
  const config = loadConfig();
  
  // 保留账号信息
  const keepKeys = ['token', 'userId', 'username', 'authType', 'anonymous'];
  const newConfig = {};
  for (const key of keepKeys) {
    if (config[key]) newConfig[key] = config[key];
  }
  
  // 恢复默认服务端
  newConfig.gateway = DEFAULT_CONFIG.gateway;
  
  saveConfig(newConfig);
  display.success('配置已重置为默认值（保留账号信息）');
}

// 显示帮助
export function showHelp() {
  console.log('');
  display.info('可用操作:');
  console.log('  list              显示所有配置');
  console.log('  get <key>         获取配置值');
  console.log('  set <key> <value> 设置配置值');
  console.log('  server [url]     查看/设置服务端地址');
  console.log('  reset             重置为默认配置');
  console.log('');
  display.info('API Key 管理:');
  console.log('  list-keys              显示所有 API Key 状态');
  console.log('  set-key --provider <名称> --key <key>  设置用户 API Key');
  console.log('  get-key --provider <名称>             获取指定提供商的 Key 状态');
  console.log('  test-key --provider <名称>            测试 API Key 是否有效');
  console.log('  del-key --provider <名称>             删除用户 API Key');
  console.log('');
  display.info('模型配置:');
  console.log('  intent-model                                          查看当前意图识别模型设置');
  console.log('  intent-model --index <序号>                           通过索引设置模型');
  console.log('  intent-model --provider <提供商> --model <模型名>     手动设置模型');
  console.log('  reasoning-model                                       查看/设置深度思考模型');
  console.log('  planning-model                                        查看/设置任务规划模型');
  console.log('  vision-model                                          查看/设置视觉理解模型');
  console.log('  flash-model                                           查看/设置简单回复/闪回模型');
  console.log('  model-settings                                        查看所有模型配置总览');
  console.log('  model-defaults                                        查看/设置全局默认模型(超管)');
  console.log('');
  display.info('对话日志:');
  console.log('  chat-log on          开启对话日志记录');
  console.log('  chat-log off         关闭对话日志记录');
  console.log('  chat-log             查看当前日志状态和路径');
  console.log('');
  display.info('对话模式:');
  console.log('  chat mode once       设为默认单次模式');
  console.log('  chat mode continuous 设为默认持续模式（默认値）');
  console.log('  chat mode           查看当前对话模式');
  console.log('');
  display.info('支持的提供商: bailian, deepseek, glm');
  display.info('也可使用提供商中文名: 百炼, deepseek, 智谱');
  console.log('');
  display.info('示例:');
  console.log('  dove config gateway http://192.168.1.100:3003');
  console.log('  dove config set timeout 60000');
  console.log('  dove config set-key --provider bailian --key sk-xxx');
  console.log('  dove config test-key --provider deepseek');
  console.log('');
  display.info('设置意图识别模型:');
  console.log('  # 方式1: 通过索引设置（推荐）');
  console.log('  dove model list -p 百炼              # 先查看模型列表和索引');
  console.log('  dove config intent-model --index 5   # 设置索引为5的模型');
  console.log('');
  console.log('  # 方式2: 手动指定');
  console.log('  dove config intent-model --provider 百炼 --model qwen3.5-flash');
  console.log('  dove config intent-model --provider deepseek --model deepseek-chat');
  console.log('');
  display.info('设置其他角色模型:');
  console.log('  dove config reasoning-model --provider 百炼 --model ' + 默认推理模型);
  console.log('  dove config planning-model --index 3');
  console.log('  dove config vision-model --provider 百炼 --model ' + 默认视觉模型);
  console.log('  dove config flash-model --provider 百炼 --model ' + 默认快速模型);
  console.log('  dove config model-settings            # 查看所有模型配置总览');
  console.log('');
  display.info('超管设置全局默认模型:');
  console.log('  dove config model-defaults            # 查看全局默认模型');
  console.log('  dove config model-defaults --provider 百炼 --model qwen3-max  # 设置默认推理模型');
}

export async function setChatLog(action) {
  const config = loadConfig();
  
  if (!action) {
    // 显示当前状态，提供交互式选择
    const enabled = config.chatLog?.enabled;
    console.log('');
    display.title('对话日志配置');
    console.log(`  状态: ${enabled ? '✓ 已开启' : '✗ 已关闭'}`);
    if (enabled) {
      console.log(`  日志目录: ${对话日志.getLogDir()}`);
      console.log(`  当日日志: ${对话日志.getTodayLogFile()}`);
    }
    console.log('');
    action = await select('选择操作', ON_OFF_CHOICES, enabled ? 'on' : 'off');
  }
  
  if (action === 'on' || action === 'true' || action === '1') {
    config.chatLog = { enabled: true };
    saveConfig(config);
    display.success('对话日志已开启');
    display.info(`日志目录: ${对话日志.getLogDir()}`);
    display.info(`当日日志: ${对话日志.getTodayLogFile()}`);
  } else if (action === 'off' || action === 'false' || action === '0') {
    config.chatLog = { enabled: false };
    saveConfig(config);
    display.success('对话日志已关闭');
  } else {
    // 显示当前状态
    const enabled = config.chatLog?.enabled;
    console.log('');
    display.title('对话日志配置');
    console.log(`  状态: ${enabled ? '✓ 已开启' : '✗ 已关闭'}`);
    if (enabled) {
      console.log(`  日志目录: ${对话日志.getLogDir()}`);
      console.log(`  当日日志: ${对话日志.getTodayLogFile()}`);
    }
    console.log('');
    display.info('开关命令:');
    console.log('  dove config chat-log on    # 开启对话日志');
    console.log('  dove config chat-log off   # 关闭对话日志');
    console.log('');
    display.info('日志按日期自动归档: chat-YYYY-MM-DD.log');
  }
}

// ==================== 对话模式配置 ====================

/**
 * 设置/查看对话模式
 * dove config chat mode once        - 设为单次模式
 * dove config chat mode continuous  - 设为持续模式（默认）
 * dove config chat                  - 查看当前状态
 */
export async function setChatMode(subKey, value) {
  const config = loadConfig();

  // dove config chat mode <once|continuous>
  if (subKey === 'mode') {
    if (!value) {
      value = await select('选择对话模式', CHAT_MODE_CHOICES, mode === 'continuous' ? 'continuous' : 'once');
    }
    if (value === 'once' || value === 'single') {
      config.chat = { ...config.chat, continuousMode: false };
      saveConfig(config);
      display.success('对话模式已设为单次模式');
      display.info('之后执行 dove chat "消息" 将回复后直接退出');
      display.info('使用 dove chat "消息" 可临时切回持续模式 (--once 反之)');
    } else if (value === 'continuous' || value === 'multi') {
      config.chat = { ...config.chat, continuousMode: true };
      saveConfig(config);
      display.success('对话模式已设为持续模式（默认）');
      display.info('之后执行 dove chat "消息" 将自动进入交互对话');
    } else if (!value) {
      // 仅显示当前模式
      const mode = config.chat?.continuousMode !== false ? 'continuous' : 'once';
      console.log('');
      display.title('对话模式配置');
      console.log(`  当前模式: ${mode === 'continuous' ? '✓ 持续模式 (默认)' : '✓ 单次模式'}`);
      console.log('');
      display.info('切换命令:');
      console.log('  dove config chat mode once       设为单次模式');
      console.log('  dove config chat mode continuous 设为持续模式');
    } else {
      display.error(`未知模式: ${value}`);
      display.info('可用模式: once, continuous');
    }
  } else if (!subKey) {
    // dove config chat  => 显示对话相关配置
    const mode = config.chat?.continuousMode !== false ? 'continuous' : 'once';
    console.log('');
    display.title('对话配置');
    console.log(`  模式: ${mode === 'continuous' ? '持续模式' : '单次模式'}`);
    console.log('');
    display.info('子命令:');
    console.log('  dove config chat mode once       设为默认单次模式');
    console.log('  dove config chat mode continuous 设为默认持续模式');
  } else {
    display.error(`未知子命令: ${subKey}`);
    display.info('可用子命令: mode');
  }
}

