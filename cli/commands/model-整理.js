/**
 * @file model-整理.js
 * @description 模型配置整理逻辑（本地执行 + 配置文件更新）
 * 从 model.js 抽取
 */

import { display } from '../display.js';
import { confirm } from '../lib/interactive.js';
import fs from 'fs';
import path from 'path';
import { 默认推理模型, 默认快速模型, 默认视觉模型, REASONING_MODELS, FAST_MODELS, VISION_MODELS } from '@dove/common/模型配置.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const PROVIDERS_FILE = path.join(PROJECT_ROOT, 'doves/providers/index.js');
const CONSTANTS_FILE = path.join(PROJECT_ROOT, 'common/模型配置.js');

/**
 * 本地执行模型整理（服务端不可用时）
 */
export async function organizeModelsLocal(options) {
  const model = options.model || 默认推理模型;
  const dryRun = options.dryRun;

  const tempFile = path.join(PROJECT_ROOT, '.model-cache.json');
  const cacheData = JSON.parse(fs.readFileSync(tempFile, 'utf-8'));

  display.info('使用默认整理规则...');
  const organizedConfig = defaultOrganize(cacheData);

  display.success('配置整理完成！');
  console.log('');
  display.info('推荐模型:');
  if (organizedConfig.recommendedModels) {
    for (const m of organizedConfig.recommendedModels.slice(0, 5)) {
      console.log(`  - ${m.id}: ${m.description}`);
    }
  }

  if (dryRun) {
    display.info('Dry-run 模式，仅预览配置:');
    console.log(JSON.stringify(organizedConfig, null, 2).slice(0, 2000));
    return;
  }

  const ok = await confirm('确认更新模型配置文件？', false);
  if (!ok) { display.info('已取消'); return; }

  await updateConfigFiles(organizedConfig, cacheData);
  display.success('模型配置已更新！');
  display.info('请重启服务使配置生效');
}

export function readCurrentConfig() {
  const config = { providers: {}, constants: {}, defaultConfig: {} };
  try { if (fs.existsSync(PROVIDERS_FILE)) config.providers.content = fs.readFileSync(PROVIDERS_FILE, 'utf-8'); } catch (e) { console.warn('[Model] 读取providers配置失败:', e.message); }
  try { if (fs.existsSync(CONSTANTS_FILE)) config.constants.content = fs.readFileSync(CONSTANTS_FILE, 'utf-8'); } catch (e) { console.warn('[Model] 读取模型配置失败:', e.message); }
  return config;
}

export function buildOrganizePrompt(cacheData, currentConfig) {
  return `以下是从百炼 API 获取的最新模型列表：

总计: ${cacheData.total} 个模型

按分类:
${JSON.stringify(cacheData.grouped, null, 2)}

请根据以上模型列表，生成模型配置。

特别说明：
1. Qwen3.6-Plus 是最新推理模型，能力最强
2. Qwen3.5-Plus 是均衡模型，支持多模态
3. Qwen3.5-Flash 是快速模型
4. Qwen3-Omni-Flash 是多模态工具默认模型，视觉+视频理解
5. DeepSeek-R1 是深度推理模型
6. DeepSeek-V3 是综合能力强的性价比模型
7. GLM-5 是智谱最新模型

请为每个模型分配合适的能力标签。
`;
}

export function defaultOrganize(cacheData) {
  return {
    models: cacheData.grouped,
    recommendedModels: [
      { id: 默认推理模型, name: 默认推理模型, description: '默认推理模型', capabilities: ['推理', '编程', '创意', '工具调用', '长文本'], contextLength: 131072 },
      { id: 'qwen3.5-plus', name: 'Qwen3.5-Plus', description: '效果、速度、成本均衡，支持多模态', capabilities: ['推理', '编程', '快速', '长文本', '多模态', '视觉', '图片理解', '视频理解', '工具调用'], contextLength: 1000000 },
      { id: 默认快速模型, name: 默认快速模型, description: '速度快、成本低、支持多模态', capabilities: ['推理', '编程', '快速', '低成本', '长文本', '多模态'], contextLength: 1000000 },
      { id: 'qwen3.5-omni-flash', name: 'Qwen3-Omni-Flash', description: '多模态工具默认模型，视觉+视频理解', capabilities: ['多模态', '视觉', '图片理解', 'OCR', '视频理解'], contextLength: 32768 },
      { id: 'deepseek-r1', name: 'DeepSeek-R1', description: '深度推理模型，适合复杂推理任务', capabilities: ['推理', '长文本'], contextLength: 65536 },
      { id: 'deepseek-v3', name: 'DeepSeek-V3', description: '综合能力强，性价比高', capabilities: ['推理', '编程', '工具调用', '低成本'], contextLength: 65536 }
    ],
    abilityToModel: {
      '推理': { model: 默认推理模型, alternatives: ['qwen3.5-plus', 'deepseek-r1', 'deepseek-v3'] },
      '编程': { model: 默认推理模型, alternatives: ['qwen3.5-plus', 'deepseek-v3'] },
      '快速': { model: 默认快速模型, alternatives: ['qwen3.5-omni-flash'] },
      '视觉': { model: 默认视觉模型, alternatives: ['qwen3.5-plus'] },
      '视频理解': { model: 默认视觉模型, alternatives: ['qwen3.5-plus'] },
      '工具调用': { model: 默认推理模型, alternatives: ['qwen3.5-plus', 'deepseek-v3'] }
    },
    reasoningModels: { primary: REASONING_MODELS.primary },
    fastModels: { primary: FAST_MODELS.primary },
    visionModels: { primary: VISION_MODELS.primary }
  };
}

export async function updateConfigFiles(organizedConfig, cacheData) {
  const models = cacheData.models.map(m => m.model_name || m);

  if (fs.existsSync(PROVIDERS_FILE)) {
    let content = fs.readFileSync(PROVIDERS_FILE, 'utf-8');
    const modelListStr = models.map(m => `      '${m}'`).join(',\n');
    const modelArrayRegex = /(百炼:\s*\{[^}]*模型:\s*\[)([\s\S]*?)(\s*\])/;
    if (modelArrayRegex.test(content)) {
      content = content.replace(modelArrayRegex, `$1\n${modelListStr}\n    $3`);
      fs.writeFileSync(PROVIDERS_FILE, content, 'utf-8');
      display.success(`已更新: ${PROVIDERS_FILE}`);
    }
  }

  if (fs.existsSync(CONSTANTS_FILE) && organizedConfig.reasoningModels) {
    let content = fs.readFileSync(CONSTANTS_FILE, 'utf-8');
    const reasoningRegex = /(export const REASONING_MODELS = \{)([\s\S]*?)(\};)/;
    if (reasoningRegex.test(content)) {
      content = content.replace(reasoningRegex, `$1\n  primary: ${JSON.stringify(organizedConfig.reasoningModels.primary)},\n  requiredCapabilities: ['推理', '工具调用']\n$3`);
    }
    const fastRegex = /(export const FAST_MODELS = \{)([\s\S]*?)(\};)/;
    if (fastRegex.test(content)) {
      content = content.replace(fastRegex, `$1\n  primary: ${JSON.stringify(organizedConfig.fastModels.primary)},\n  requiredCapabilities: ['快速', '低成本']\n$3`);
    }
    if (organizedConfig.visionModels) {
      const visionRegex = /(export const VISION_MODELS = \{)([\s\S]*?)(\};)/;
      if (visionRegex.test(content)) {
        content = content.replace(visionRegex, `$1\n  primary: ${JSON.stringify(organizedConfig.visionModels.primary)},\n  requiredCapabilities: ['多模态', '视觉']\n$3`);
      }
    }
    fs.writeFileSync(CONSTANTS_FILE, content, 'utf-8');
    display.success(`已更新: ${CONSTANTS_FILE}`);
  }

  const configFile = path.join(PROJECT_ROOT, 'doves/config/model-config.json');
  const configDir = path.dirname(configFile);
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(organizedConfig, null, 2), 'utf-8');
  display.success(`已保存完整配置: ${configFile}`);
}
