/**
 * 配置命令
 * 用法: dove config [action] [options]
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { display } from '../display.js';
import { 
  loadConfig as loadConfigFromModule, 
  saveConfig as saveConfigToModule,
  getConfigPath
} from '../lib/config.js';
import { select } from '../lib/interactive.js';

import { setGateway, showGateway, manageGateways } from './config/网关管理.js';
import { setConfig, getConfig, listConfig, resetConfig, showHelp, setChatLog, setChatMode } from './config/配置管理.js';
import { listApiKeys, setApiKey, getApiKey, testApiKey, deleteApiKey } from './config/API密钥管理.js';
import { setIntentModel, setModelRole, showModelSettings, setModelDefaults } from './config/模型配置.js';

const CONFIG_FILE = getConfigPath();

function loadConfig() {
  return loadConfigFromModule();
}

function saveConfig(config) {
  return saveConfigToModule(config);
}

export { loadConfig, saveConfig };

const CONFIG_ACTION_CHOICES = [
  { name: 'list          - 显示所有配置', value: 'list' },
  { name: 'get           - 获取配置值', value: 'get' },
  { name: 'set           - 设置配置值', value: 'set' },
  { name: 'gateway       - 查看/设置服务端地址', value: 'gateway' },
  { name: 'gateways      - 多服务端管理（扇出/容灾双模式）', value: 'gateways' },
  { name: 'reset         - 重置为默认配置', value: 'reset' },
  { name: 'set-key       - 设置 API Key', value: 'set-key' },
  { name: 'get-key       - 获取 API Key 状态', value: 'get-key' },
  { name: 'list-keys     - 显示所有 API Key 状态', value: 'list-keys' },
  { name: 'test-key      - 测试 API Key', value: 'test-key' },
  { name: 'del-key       - 删除 API Key', value: 'del-key' },
  { name: 'intent-model  - 查看/设置意图识别模型', value: 'intent-model' },
  { name: 'reasoning-model - 查看/设置深度思考模型', value: 'reasoning-model' },
  { name: 'planning-model  - 查看/设置任务规划模型', value: 'planning-model' },
  { name: 'vision-model    - 查看/设置视觉理解模型', value: 'vision-model' },
  { name: 'flash-model     - 查看/设置闪回模型', value: 'flash-model' },
  { name: 'model-settings  - 查看所有模型配置总览', value: 'model-settings' },
  { name: 'model-defaults  - 查看/设置全局默认模型', value: 'model-defaults' },
  { name: 'chat-log        - 对话日志开关', value: 'chat-log' },
  { name: 'chat            - 对话模式配置', value: 'chat' },
];

export const configCommand = new Command('config')
  .description('配置管理 (网关/模型/API Key/对话设置)')
  .argument('[action]', '操作 (list|get|set|gateway|gateways|... 留空交互选择)')
  .argument('[key]', '配置键')
  .argument('[value]', '配置值')
  .option('-p, --provider <provider>', '提供商')
  .option('-m, --model <model>', '模型名')
  .option('-i, --index <index>', '模型索引号')
  .option('-r, --role <role>', '角色 (自定义模型用)')
  .option('-k, --key <key>', 'API Key 值')
  .option('-t, --test <testKey>', '测试 API Key')
  .action(async (action, key, value, cmd) => {
    // Commander 11+: action 回调的最后一个参数就是 options 对象，无需 .opts()
    const options = typeof cmd.opts === 'function' ? cmd.opts() : cmd;

    try {
      switch (action) {
        case 'list':
          await listConfig();
          break;
        case 'get':
          await getConfig(key);
          break;
        case 'set':
          await setConfig(key, value);
          break;
        case 'gateway':
          if (key) {
            await setGateway(key);
          } else {
            await showGateway();
          }
          break;
        case 'gateways':
          await manageGateways(key, value);
          break;
        case 'reset':
          await resetConfig();
          break;
        case 'set-key':
          await setApiKey(options.provider, options.key);
          break;
        case 'get-key':
          await getApiKey(options.provider);
          break;
        case 'list-keys':
          await listApiKeys();
          break;
        case 'test-key':
          await testApiKey(options.provider, options.test);
          break;
        case 'del-key':
          await deleteApiKey(options.provider);
          break;
        case 'intent-model':
          await setIntentModel(options.provider, options.model, options.index);
          break;
        case 'reasoning-model':
          await setModelRole('reasoningModel', options.provider, options.model, options.index);
          break;
        case 'planning-model':
          await setModelRole('planningModel', options.provider, options.model, options.index);
          break;
        case 'vision-model':
          await setModelRole('visionModel', options.provider, options.model, options.index);
          break;
        case 'flash-model':
          await setModelRole('flashModel', options.provider, options.model, options.index);
          break;
        case 'model-settings':
          await showModelSettings();
          break;
        case 'model-defaults':
          await setModelDefaults(options.provider, options.model, options.index, options.role);
          break;
        case 'chat-log':
          await setChatLog(key);
          break;
        case 'chat':
          await setChatMode(key, value);
          break;
        case undefined:
          // 交互模式
          const { choice } = await inquirer.prompt([{
            type: 'list',
            name: 'choice',
            message: '请选择操作:',
            choices: CONFIG_ACTION_CHOICES,
            pageSize: 15
          }]);

          const subCmd = configCommand.commands.find(c => c.name() === choice);
          if (subCmd) {
            display.info(`请使用子命令: dove config ${choice}`);
            display.info('用法: dove config ' + choice + ' --help');
          } else {
            switch (choice) {
              case 'list': await listConfig(); break;
              case 'get': {
                const { key: k } = await inquirer.prompt([{ type: 'input', name: 'key', message: '配置键名:' }]);
                await getConfig(k);
                break;
              }
              case 'set': {
                const { key: k } = await inquirer.prompt([{ type: 'input', name: 'key', message: '配置键名:' }]);
                const { value: v } = await inquirer.prompt([{ type: 'input', name: 'value', message: '配置值:' }]);
                await setConfig(k, v);
                break;
              }
              case 'gateway': {
                const { url } = await inquirer.prompt([{ type: 'input', name: 'url', message: '服务端地址:' }]);
                if (url) await setGateway(url); else await showGateway();
                break;
              }
              case 'gateways': await manageGateways(); break;
              case 'reset': await resetConfig(); break;
              case 'set-key': {
                const { provider: p } = await inquirer.prompt([{ type: 'input', name: 'provider', message: '提供商:' }]);
                const { key: k } = await inquirer.prompt([{ type: 'password', name: 'key', message: 'API Key:' }]);
                await setApiKey(p, k);
                break;
              }
              case 'get-key': {
                const { provider: p } = await inquirer.prompt([{ type: 'input', name: 'provider', message: '提供商:' }]);
                await getApiKey(p);
                break;
              }
              case 'list-keys': await listApiKeys(); break;
              case 'test-key': {
                const { provider: p } = await inquirer.prompt([{ type: 'input', name: 'provider', message: '提供商:' }]);
                const { key: k } = await inquirer.prompt([{ type: 'password', name: 'key', message: 'API Key:' }]);
                await testApiKey(p, k);
                break;
              }
              case 'del-key': {
                const { provider: p } = await inquirer.prompt([{ type: 'input', name: 'provider', message: '提供商:' }]);
                await deleteApiKey(p);
                break;
              }
              case 'intent-model': await setIntentModel(); break;
              case 'reasoning-model': await setModelRole('reasoningModel'); break;
              case 'planning-model': await setModelRole('planningModel'); break;
              case 'vision-model': await setModelRole('visionModel'); break;
              case 'flash-model': await setModelRole('flashModel'); break;
              case 'model-settings': await showModelSettings(); break;
              case 'model-defaults': await setModelDefaults(); break;
              case 'chat-log': {
                const { action: a } = await inquirer.prompt([{ type: 'input', name: 'action', message: 'on/off/status:' }]);
                await setChatLog(a);
                break;
              }
              case 'chat': {
                const { mode } = await inquirer.prompt([{ type: 'input', name: 'mode', message: '模式 (once/continuous):' }]);
                await setChatMode('mode', mode);
                break;
              }
              default:
                display.error(`未知操作: ${action}`);
                showHelp();
            }
          }
          break;
        default:
          display.error(`未知操作: ${action}`);
          showHelp();
      }
    } catch (err) {
      display.error(err.message);
      process.exit(1);
    }
  });

// ==================== 子命令: config model ====================
configCommand.command('model')
  .description('模型配置 (刷新/整理/列表)')
  .argument('[action]', 'refresh|organize|list')
  .action(async (action) => {
    if (action === 'list' || !action) {
      await showModelSettings();
    } else {
      display.info(`模型${action}功能请通过 dove model 命令使用`);
    }
  });

// ==================== 子命令: config profile ====================
configCommand.command('profile')
  .description('执行配置管理')
  .argument('[action]', 'list|show|create|delete')
  .action(async (action) => {
    display.info('请使用 dove profile 命令管理执行配置');
    display.info('用法: dove profile list|show|create|delete');
  });

export default configCommand;
