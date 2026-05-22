/**
 * 模型配置整理技能
 * 使用深度思考模型整理模型配置
 * 
 * 功能：
 * - 分析从 API 获取的最新模型列表
 * - 根据模型名称和特征判断能力
 * - 生成结构化的模型配置 JSON
 * 
 * 走标准白鸽流程：通过 KeyManager 获取 API Key，使用 LLMCaller 调用模型
 */

import { 提供商客户端, 提供商列表 } from '../../providers/index.js';
import { KeyManager } from '../../llm/index.js';
import { createTimestampFields } from '@dove/common/时间工具.js';
import { 默认推理模型, 默认快速模型, 默认视觉模型, REASONING_MODELS, FAST_MODELS, VISION_MODELS, PROVIDER_ENDPOINTS } from '../../常量.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目根目录
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const PROVIDERS_FILE = path.join(PROJECT_ROOT, 'doves/providers/index.js');
const CONSTANTS_FILE = path.join(PROJECT_ROOT, 'common/模型配置.js');
const MODEL_CACHE_FILE = path.join(PROJECT_ROOT, '.model-cache.json');

import { 创建日志器 } from '@dove/common/日志管理器.js';

/**
 * 日志器
 */
const logger = 创建日志器('模型整理', { 前缀: '[模型整理]', 级别: 'debug', 显示调用位置: true });

/**
 * 构建整理 prompt
 */
function buildOrganizePrompt(cacheData, currentConfig) {
  return `
以下是从百炼 API 获取的最新模型列表：

总计: ${cacheData.total} 个模型

按分类:
${JSON.stringify(cacheData.grouped, null, 2)}

请根据以上模型列表，生成模型配置。

模型说明:
1. Qwen3-Max: 最新旗舰模型，能力最强
2. Qwen3.5-Plus: 均衡模型，支持多模态
3. Qwen3.5-Flash: 快速模型
4. Qwen3-Coder-Plus: 编程专用
5. Qwen-VL-Max: 视觉理解最强
6. QVQ-Max: 视频理解专用
7. DeepSeek-R1: 深度推理
8. DeepSeek-V3: 综合能力强，性价比高
9. GLM-5: 智谱最新模型

请为每个模型分配合适的能力标签。
`;
}

/**
 * 读取当前配置
 */
function readCurrentConfig() {
  const config = {
    providers: {},
    constants: {},
    defaultConfig: {}
  };
  
  try {
    if (fs.existsSync(PROVIDERS_FILE)) {
      config.providers.content = fs.readFileSync(PROVIDERS_FILE, 'utf-8');
    }
  } catch (e) {
    logger.debug(`读取 providers 配置失败: ${e.message}`);
  }
  
  try {
    if (fs.existsSync(CONSTANTS_FILE)) {
      config.constants.content = fs.readFileSync(CONSTANTS_FILE, 'utf-8');
    }
  } catch (e) {
    logger.debug(`读取 constants 配置失败: ${e.message}`);
  }
  
  return config;
}

/**
 * 更新配置文件
 */
async function updateConfigFiles(organizedConfig, cacheData) {
  const models = cacheData.models.map(m => m.model_name || m);
  
  // 更新 providers/index.js 中的模型列表
  if (fs.existsSync(PROVIDERS_FILE)) {
    let content = fs.readFileSync(PROVIDERS_FILE, 'utf-8');
    
    const modelListStr = models.map(m => `      '${m}'`).join(',\n');
    
    const modelArrayRegex = /(百炼:\s*\{[^}]*模型:\s*\[)([\s\S]*?)(\s*\])/;
    if (modelArrayRegex.test(content)) {
      content = content.replace(modelArrayRegex, `$1\n${modelListStr}\n    $3`);
      fs.writeFileSync(PROVIDERS_FILE, content, 'utf-8');
      logger.info(`已更新: ${PROVIDERS_FILE}`);
    }
  }
  
  // 更新 common/模型配置.js（统一配置源）
  if (fs.existsSync(CONSTANTS_FILE) && organizedConfig.reasoningModels) {
    let content = fs.readFileSync(CONSTANTS_FILE, 'utf-8');
    
    const reasoningRegex = /(export const REASONING_MODELS = \{)([\s\S]*?)(\};)/;
    if (reasoningRegex.test(content)) {
      const newReasoning = `
  primary: ${JSON.stringify(organizedConfig.reasoningModels.primary)},
  requiredCapabilities: ['推理', '工具调用']`;
      content = content.replace(reasoningRegex, `$1${newReasoning}\n$3`);
    }
    
    const fastRegex = /(export const FAST_MODELS = \{)([\s\S]*?)(\};)/;
    if (fastRegex.test(content)) {
      const newFast = `
  primary: ${JSON.stringify(organizedConfig.fastModels.primary)},
  requiredCapabilities: ['快速', '低成本']`;
      content = content.replace(fastRegex, `$1${newFast}\n$3`);
    }
    
    // 更新 VISION_MODELS
    if (organizedConfig.visionModels) {
      const visionRegex = /(export const VISION_MODELS = \{)([\s\S]*?)(\};)/;
      if (visionRegex.test(content)) {
        const newVision = `
  primary: ${JSON.stringify(organizedConfig.visionModels.primary)},
  requiredCapabilities: ['多模态', '视觉']`;
        content = content.replace(visionRegex, `$1${newVision}\n$3`);
      }
    }
    
    fs.writeFileSync(CONSTANTS_FILE, content, 'utf-8');
    logger.info(`已更新: ${CONSTANTS_FILE}`);
  }
  
  // 保存整理后的完整配置
  const configDir = path.join(PROJECT_ROOT, 'doves/config');
  const configFile = path.join(configDir, 'model-config.json');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configFile, JSON.stringify(organizedConfig, null, 2), 'utf-8');
  logger.info(`已保存完整配置: ${configFile}`);
}

/**
 * 执行模型配置整理
 * @param {Object} 参数 - 执行参数
 * @param {Object} 上下文 - 执行上下文
 * @returns {Object} 执行结果
 */
async function execute(参数, 上下文 = {}) {
  const { model, dryRun } = 参数;
  const targetModel = model || 默认推理模型;
  
  logger.info(`开始整理模型配置，使用模型: ${targetModel}`);
  
  try {
    // 读取缓存的模型列表
    if (!fs.existsSync(MODEL_CACHE_FILE)) {
      return {
        成功: false,
        错误: '未找到模型缓存文件，请先执行: dove model refresh'
      };
    }
    
    const cacheData = JSON.parse(fs.readFileSync(MODEL_CACHE_FILE, 'utf-8'));
    logger.info(`使用缓存的模型列表 (${cacheData.fetchedAt})`);
    
    // 读取现有配置
    const currentConfig = readCurrentConfig();
    
    let organizedConfig = null;
    
    // 获取 KeyManager（从上下文或创建新的）
    let keyManager = 上下文.keyManager;
    if (!keyManager && 上下文.数据库连接) {
      keyManager = new KeyManager({
        数据库连接: 上下文.数据库连接,
        用户数据库名: 上下文.数据库名 || 'doves_user_data',
        系统配置: 上下文.系统配置
      });
    }
    
    // 提供商优先级：百炼 > DeepSeek > GLM
    const providerPriority = ['百炼', 'DeepSeek', 'GLM'];
    let selectedProvider = null;
    let apiKey = null;
    
    // 尝试获取 API Key
    if (keyManager) {
      for (const provider of providerPriority) {
        const keyConfig = keyManager.获取官方Key?.(provider);
        if (keyConfig?.apiKey) {
          selectedProvider = provider;
          apiKey = keyConfig.apiKey;
          break;
        }
      }
    }
    
    if (!selectedProvider || !apiKey) {
      return {
        成功: false,
        错误: '未找到可用的 API Key，无法进行模型配置整理。请先配置 API Key。'
      };
    } else {
      // 使用 LLM 整理配置
      logger.info(`使用 ${selectedProvider}/${targetModel} 进行配置整理...`);
      
      const providerConfig = 提供商列表[selectedProvider];
      const endpoint = providerConfig?.端点 || PROVIDER_ENDPOINTS['百炼'];
      
      try {
        const client = new 提供商客户端(selectedProvider, { API密钥: apiKey });
        
        const systemPrompt = `分析模型列表，根据名称和特征判断能力，生成结构化配置JSON。

输出JSON包含:
- models: 完整模型列表（按类别分组）
- recommendedModels: 推荐模型列表（id, name, description, capabilities, contextLength）
- abilityToModel: 按能力选模型的映射
- reasoningModels: 推理模型配置 { primary: [] }
- fastModels: 快速模型配置 { primary: [] }

能力列表: 推理, 编程, 创意, 快速, 长文本, 多模态, 视觉, 图片理解, 图片生成, 视频理解, OCR, 界面理解, 工具调用, 多语言, 低成本, 语音合成, 语音识别, 数学推理

只输出JSON。`;

        const prompt = buildOrganizePrompt(cacheData, currentConfig);
        
        const result = await client.调用({
          model: targetModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 8000
        });
        
        if (!result.成功) {
          throw new Error(result.错误 || 'LLM 调用失败');
        }
        
        // 提取 JSON 部分
        const content = result.内容;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          organizedConfig = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('无法从响应中提取 JSON');
        }
        
      } catch (e) {
        logger.error(`LLM 调用失败: ${e.message}`);
        throw e;
      }
    }
    
    // 显示整理结果
    logger.info('配置整理完成！');
    
    const result = {
      成功: true,
      organizedConfig,
      stats: {
        totalModels: cacheData.total,
        recommendedCount: organizedConfig.recommendedModels?.length || 0,
        categories: Object.keys(organizedConfig.models || {}).length
      }
    };
    
    if (dryRun) {
      result.message = 'Dry-run 模式，配置未写入文件';
      return result;
    }
    
    // 更新配置文件
    await updateConfigFiles(organizedConfig, cacheData);
    
    result.message = '模型配置已更新，请重启服务使配置生效';
    return result;
    
  } catch (错误) {
    logger.error('模型配置整理失败:', 错误);
    return {
      成功: false,
      错误: 错误.message
    };
  }
}

// 技能描述（包含权限要求）
const 描述 = {
  name: '模型整理',
  description: '使用深度思考模型整理模型配置，分析模型列表并生成结构化配置',
  // 权限要求：此技能需要管理员权限
  requiredRole: 'admin',
  parameters: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        description: '用于整理的深度思考模型 (默认: 从统一配置读取)',
        default: 默认推理模型
      },
      dryRun: {
        type: 'boolean',
        description: '仅预览，不写入文件',
        default: false
      }
    },
    required: []
  }
};

export default {
  name: '模型整理',
  description: 描述.description,
  requiredRole: 描述.requiredRole,  // 导出权限要求

  // 内置技能，不需要拥有权检查
  需要拥有权: false,

  // 能力声明
  abilities: ['模型配置', '系统管理'],
  
  parameters: 描述.parameters,
  execute
};
