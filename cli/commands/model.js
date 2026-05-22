/**
 * 模型命令
 * 用法: dove model [action] [options]
 * 
 * 功能:
 * - refresh: 从百炼 API 获取最新模型列表
 * - organize: 使用深度思考模型整理模型配置
 * - list: 显示当前模型配置
 */

import { Command } from 'commander';
import { display } from '../display.js';
import { DoveClient, AdminClient } from '../client.js';
import { loadConfig } from '../lib/config.js';
import { select, PROVIDER_CHOICES } from '../lib/interactive.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 默认推理模型, normalizeProvider, PROVIDER_ENDPOINTS, PROVIDER_TEST_ENDPOINTS } from '@dove/common/模型配置.js';
import { organizeModelsLocal, readCurrentConfig, buildOrganizePrompt, defaultOrganize, updateConfigFiles } from './model-整理.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目根目录
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const PROVIDERS_FILE = path.join(PROJECT_ROOT, 'doves/providers/index.js');
const CONSTANTS_FILE = path.join(PROJECT_ROOT, 'common/模型配置.js');
const CORE_FILE = path.join(PROJECT_ROOT, 'server/core.js');

const MODEL_ACTION_CHOICES = [
  { name: 'refresh  - 刷新模型列表', value: 'refresh' },
  { name: 'organize - 整理模型配置', value: 'organize' },
  { name: 'list     - 显示模型列表', value: 'list' },
];

export const modelCommand = new Command('model')
  .description('模型配置管理')
  .argument('[action]', '操作: refresh|organize|list')
  .option('-p, --provider <provider>', '指定提供商 (默认: bailian)')
  .option('-m, --model <model>', '指定用于整理的深度思考模型 (默认: qwen3-max)')
  .option('-o, --output', '输出配置文件路径')
  .option('--dry-run', '仅预览，不写入文件')
  .option('-a, --all', '查看所有用户的模型配置（仅超级管理员可用）')
  .option('--uid <userId>', '查看指定用户的模型配置（仅超级管理员可用）')
  .action(async (action, options) => {
    const config = loadConfig();
    const client = config.role === 'admin' ? new AdminClient() : new DoveClient();
    const authed = await client.ensureAuth();
    if (!authed) {
      display.error('登录已过期，请重新执行 dove login');
      process.exit(1);
    }
    
    // 超管 --all 权限检查
    if (options.all) {
      if (!client.isAdmin()) {
        display.error('--all 选项仅超级管理员可用，请使用 dove login --admin 登录');
        process.exit(1);
      }
      client.setAdminAll(true);
    }
    
    // 超管 --uid 权限检查
    if (options.uid) {
      if (!client.isAdmin()) {
        display.error('--uid 选项仅超级管理员可用，请使用 dove login --admin 登录');
        process.exit(1);
      }
      client.setTargetUserId(options.uid);
    }

    try {
      // 无 action 时进入交互式选择
      if (!action) {
        action = await select('选择操作', MODEL_ACTION_CHOICES);
      }

      switch (action) {
        case 'refresh':
          await refreshModels(options);
          break;
        case 'organize':
          await organizeModels(options);
          break;
        case 'list':
          await listModels(options);
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

/**
 * 从各提供商 API 获取最新模型列表
 * 并存入管理库
 */
async function refreshModels(options) {
  let provider = options.provider;
  if (!provider) {
    provider = await select('选择提供商', PROVIDER_CHOICES, '百炼');
  }
  // 归一化提供商名称
  const providerDisplayName = normalizeProvider(provider);
  
  display.title(`刷新 ${providerDisplayName} 模型列表`);
  
  const client = new DoveClient();
  
  // 获取 API Key
  display.info('正在获取 API Key...');
  const keysData = await client.getUserKeys();
  
  let apiKey = keysData.userKeys?.[provider]?.key;
  if (!apiKey) {
    // 尝试获取官方 Key
    const officialKey = keysData.officialKeys?.[provider];
    if (officialKey?.configured) {
      display.info(`使用官方 ${providerDisplayName} API Key`);
      // 需要从环境变量获取
      apiKey = process.env[`${provider.toUpperCase()}_API_KEY`] || 
               process.env.BAILIAN_API_KEY;
    }
  }
  
  if (!apiKey) {
    display.error(`未找到 ${providerDisplayName} 的 API Key`);
    display.info('请先配置 API Key: dove config set-key --provider ' + provider);
    return;
  }
  
  display.info('正在从 API 获取模型列表...');
  
  try {
    const models = await fetchProviderModels(apiKey, provider);
    
    display.success(`获取到 ${models.length} 个模型`);
    
    // 按类型分组
    const grouped = categorizeModels(models);
    
    console.log('');
    display.info('模型分类统计:');
    for (const [category, modelList] of Object.entries(grouped)) {
      console.log(`  ${category}: ${modelList.length} 个`);
    }
    
    // 构建存储格式（模型名 + 分类信息）
    const modelList = models.map(m => ({
      name: m.model_name,
      category: getModelCategory(m.model_name)
    }));
    
    // 存入管理库
    display.info('正在存入数据库...');
    await client.updateModelList(providerDisplayName, modelList);
    
    display.success(`模型列表已存入数据库 (${modelList.length} 个模型)`);
    display.info('使用 dove model list 查看模型列表');
    display.info('使用 dove config reasoning-model --index <序号> 设置模型');
    
  } catch (err) {
    display.error(`获取模型列表失败: ${err.message}`);
    throw err;
  }
}

/**
 * 根据模型名获取分类
 */
function getModelCategory(modelName) {
  const name = modelName.toLowerCase();
  if (name.includes('qwen3')) return 'Qwen3系列';
  if (name.includes('qwen2.5')) return 'Qwen2.5系列';
  if (name.includes('qwen')) return 'Qwen经典系列';
  if (name.includes('coder')) return 'Coder系列';
  if (name.includes('vl') || name.includes('vision')) return 'VL视觉系列';
  if (name.includes('qvq')) return 'QVQ视频系列';
  if (name.includes('image')) return '图像生成';
  if (name.includes('tts') || name.includes('asr')) return '语音模型';
  if (name.includes('deepseek')) return 'DeepSeek';
  if (name.includes('glm')) return 'GLM';
  return '其他';
}

/**
 * 调用各提供商 API 获取模型列表
 * 使用 OpenAI 兼容接口: GET /v1/models
 */
async function fetchProviderModels(apiKey, provider) {
  // 端点从全局配置获取，先尝试测试端点（/models），再尝试主端点
  const normalized = normalizeProvider(provider);
  const endpoint = PROVIDER_TEST_ENDPOINTS[normalized] || `${PROVIDER_ENDPOINTS[normalized]}/models`;
  
  if (!endpoint) {
    throw new Error(`不支持的提供商: ${provider}`);
  }

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${text}`);
  }
  
  const data = await response.json();
  
  // OpenAI 兼容格式: { data: [{ id: 'model-name', ... }, ...] }
  const models = (data.data || []).map(m => ({
    model_name: m.id,
    owned_by: m.owned_by || '未知'
  }));
  
  return models;
}

/**
 * 模型分类
 */
function categorizeModels(models) {
  const categories = {
    'Qwen3系列': [],
    'Qwen2.5系列': [],
    'Qwen经典系列': [],
    'Coder系列': [],
    'VL视觉系列': [],
    'QVQ视频系列': [],
    '图像生成': [],
    '语音模型': [],
    '专用模型': [],
    '第三方模型': [],
    '其他': []
  };
  
  for (const model of models) {
    const name = model.model_name || model;
    
    if (name.includes('qwen3') || name.includes('qwen-3')) {
      if (name.includes('coder')) {
        categories['Coder系列'].push(name);
      } else if (name.includes('vl') || name.includes('vision')) {
        categories['VL视觉系列'].push(name);
      } else if (name.includes('tts') || name.includes('asr') || name.includes('omni')) {
        categories['语音模型'].push(name);
      } else {
        categories['Qwen3系列'].push(name);
      }
    } else if (name.includes('qwen2.5') || name.includes('qwen-2.5')) {
      if (name.includes('vl') || name.includes('vision')) {
        categories['VL视觉系列'].push(name);
      } else if (name.includes('coder')) {
        categories['Coder系列'].push(name);
      } else {
        categories['Qwen2.5系列'].push(name);
      }
    } else if (name.includes('qwen')) {
      if (name.includes('coder')) {
        categories['Coder系列'].push(name);
      } else if (name.includes('vl') || name.includes('vision')) {
        categories['VL视觉系列'].push(name);
      } else if (name.includes('image')) {
        categories['图像生成'].push(name);
      } else if (name.includes('long')) {
        categories['专用模型'].push(name);
      } else {
        categories['Qwen经典系列'].push(name);
      }
    } else if (name.includes('qvq')) {
      categories['QVQ视频系列'].push(name);
    } else if (name.includes('deepseek')) {
      categories['第三方模型'].push(name);
    } else if (name.includes('glm')) {
      categories['第三方模型'].push(name);
    } else if (name.includes('kimi')) {
      categories['第三方模型'].push(name);
    } else if (name.includes('gui') || name.includes('math') || name.includes('mt-')) {
      categories['专用模型'].push(name);
    } else {
      categories['其他'].push(name);
    }
  }
  
  // 移除空分类
  for (const key of Object.keys(categories)) {
    if (categories[key].length === 0) {
      delete categories[key];
    }
  }
  
  return categories;
}

/**
 * 使用深度思考模型整理模型配置
 * 
 * 走标准白鸽流程：
 * 1. 通过服务端创建 skill_model_organize 任务
 * 2. 鸽子抢取任务并执行
 * 3. CLI 监听任务进度
 * 
 * 好处：
 * - 统一使用 KeyManager 获取 API Key
 * - 统一使用 LLMCaller 调用模型
 * - 日志统一记录
 * - 任务可追踪
 */
async function organizeModels(options) {
  const model = options.model || 默认推理模型;
  const dryRun = options.dryRun;
  
  display.title('整理模型配置');
  
  // 检查缓存文件是否存在（鸽子执行时也会检查）
  const tempFile = path.join(PROJECT_ROOT, '.model-cache.json');
  if (!fs.existsSync(tempFile)) {
    display.error('未找到模型缓存文件，请先执行: dove model refresh');
    return;
  }
  
  const cacheData = JSON.parse(fs.readFileSync(tempFile, 'utf-8'));
  display.info(`使用缓存的模型列表 (${cacheData.fetchedAt})`);
  display.info(`将使用 ${model} 进行配置整理...`);
  
  // 创建服务端客户端
  const client = new DoveClient();
  
  display.info('正在通过服务端创建任务...');
  
  try {
    // 创建技能任务
    const task = await client.createTask('整理模型配置', {
      type: 'skill_model_organize',
      params: {
        model,
        dryRun
      }
    });
    
    display.info(`任务已创建: ${task.id}`);
    display.info('等待鸽子执行...');
    
    // 监听任务进度
    const finalTask = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('任务执行超时（120秒）'));
      }, 120000);
      
      client.watchTask(task.id, (updatedTask) => {
        if (updatedTask.status === '已完成' || updatedTask.status === '已完成(部分失败)' || updatedTask.status === '失败') {
          clearTimeout(timeout);
          resolve(updatedTask);
        }
      }).catch(reject);
    });
    
    // 处理结果
    if (finalTask.status === '失败') {
      display.error(`任务执行失败: ${finalTask.error || '未知错误'}`);
      return;
    }
    
    const result = finalTask.result || {};
    
    if (!result.success && !result.成功) {
      display.error(`整理失败: ${result.error || result.错误 || '未知错误'}`);
      return;
    }
    
    // 显示整理结果
    display.success('配置整理完成！');
    
    const organizedConfig = result.organizedConfig || {};
    
    console.log('');
    display.info('推荐模型:');
    if (organizedConfig.recommendedModels) {
      for (const m of organizedConfig.recommendedModels.slice(0, 5)) {
        console.log(`  - ${m.id}: ${m.description}`);
      }
      if (organizedConfig.recommendedModels.length > 5) {
        console.log(`  ... 共 ${organizedConfig.recommendedModels.length} 个推荐模型`);
      }
    }
    
    if (result.message) {
      display.info(result.message);
    }
    
    if (dryRun) {
      display.info('Dry-run 模式，配置未写入文件');
      console.log(JSON.stringify(organizedConfig, null, 2).slice(0, 2000));
      return;
    }
    
    display.success('模型配置已更新！');
    display.info('请重启服务使配置生效');
    
  } catch (e) {
    display.error(`服务端任务创建失败: ${e.message}`);
    throw e;
  }
}

/**
 * 显示当前模型配置
 * 从管理库读取模型列表，带索引显示
 * 统一展示所有提供商的模型，每条带厂商名
 */
async function listModels(options) {
  const provider = options.provider;

  display.title('模型列表');

  try {
    const client = new DoveClient();
    const data = await client.getModelList(provider);
    const providers = data.providers || {};

    if (Object.keys(providers).length === 0) {
      display.warn('未找到任何模型列表');
      display.info('请先刷新: dove model refresh');
      return;
    }

    if (provider) {
      // 显示指定提供商的模型
      const models = providers[provider];
      if (!models || models.length === 0) {
        display.warn(`未找到 ${provider} 的模型列表`);
        display.info('请先刷新: dove model refresh -p ' + provider);
        return;
      }

      console.log('');
      display.info(`${provider} 模型列表 (${models.length} 个):`);
      console.log('─'.repeat(60));

      // 按分类分组
      const grouped = {};
      for (const m of models) {
        const cat = m.category || '其他';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(m.name);
      }

      let index = 1;
      for (const [cat, modelList] of Object.entries(grouped)) {
        console.log(`\n[${cat}]`);
        for (const m of modelList) {
          console.log(`  ${(index++).toString().padStart(3)}. ${provider}/${m}`);
        }
      }

      console.log('');
      display.info('使用 dove config intent-model --index <序号> 设置模型');

    } else {
      // 显示所有提供商的模型 —— 合并为统一列表
      console.log('');

      // 统计各提供商模型数量
      display.info('各提供商模型统计:');
      console.log('─'.repeat(60));
      for (const [p, models] of Object.entries(providers)) {
        console.log(`  ${p.padEnd(10)} ${models.length} 个模型`);
      }

      // 合并所有提供商模型，统一编号
      console.log('');
      display.info('全部模型列表:');
      console.log('─'.repeat(60));

      let index = 1;
      for (const [p, models] of Object.entries(providers)) {
        for (const m of models) {
          const name = typeof m === 'string' ? m : m.name;
          const cat = typeof m === 'object' ? m.category || '' : '';
          const catTag = cat ? ` [${cat}]` : '';
          console.log(`  ${(index++).toString().padStart(3)}. ${p}/${name}${catTag}`);
        }
      }

      console.log('');
      display.info('使用 dove config reasoning-model --index <序号> 设置推理模型');
      display.info('使用 dove model list -p <提供商> 查看指定提供商的模型列表');
    }

    if (data.updatedAt) {
      console.log('');
      display.info(`模型列表更新时间: ${data.updatedAt}`);
    }

  } catch (err) {
    display.error(`获取模型列表失败: ${err.message}`);
    throw err;
  }
}

/**
 * 从本地文件读取模型配置（备用）
 */
async function listModelsFromLocal(options) {
  const provider = options.provider || 'bailian';
  
  // 读取 providers 配置
  if (fs.existsSync(PROVIDERS_FILE)) {
    const content = fs.readFileSync(PROVIDERS_FILE, 'utf-8');
    
    // 提取百炼配置
    const match = content.match(/百炼:\s*\{[\s\S]*?^\s{2}\}/m);
    if (match) {
      console.log('\n百炼提供商配置:');
      console.log('─'.repeat(50));
      
      // 提取模型列表
      const modelsMatch = match[0].match(/模型:\s*\[([\s\S]*?)\]/);
      if (modelsMatch) {
        const models = modelsMatch[1]
          .split(',')
          .map(s => s.trim().replace(/'/g, ''))
          .filter(s => s && !s.startsWith('//'));
        
        console.log(`模型总数: ${models.length}`);
        console.log('\n前 10 个模型:');
        models.slice(0, 10).forEach((m, i) => {
          console.log(`  ${(i+1).toString().padStart(2)}. ${m}`);
        });
        if (models.length > 10) {
          console.log(`  ... 共 ${models.length} 个模型`);
        }
      }
    }
  }
}

// interactiveMode 已移除，由 action 参数 + select() 统一处理

/**
 * 显示帮助
 */
function showHelp() {
  console.log('');
  display.info('可用操作:');
  console.log('  refresh     从 API 获取最新模型列表并存入数据库');
  console.log('  organize    使用深度思考模型整理模型配置');
  console.log('  list        显示模型列表（带索引）');
  console.log('');
  display.info('选项:');
  console.log('  -p, --provider <name>   指定提供商 (默认: bailian, 可选: deepseek, glm)');
  console.log('  -m, --model <name>      指定用于整理的深度思考模型 (默认: qwen3-max)');
  console.log('  --dry-run               仅预览，不写入文件');
  console.log('');
  display.info('示例:');
  console.log('  dove model refresh                    # 刷新百炼模型列表');
  console.log('  dove model refresh -p deepseek        # 刷新 DeepSeek 模型列表');
  console.log('  dove model list                       # 显示所有提供商统计');
  console.log('  dove model list -p 百炼               # 显示百炼模型列表（带索引）');
  console.log('');
  display.info('设置意图识别模型:');
  console.log('  dove config intent-model --index 5    # 通过索引设置模型');
}

export default modelCommand;
