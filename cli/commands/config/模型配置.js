/**
 * 模型配置 - 意图识别模型、多角色模型与默认模型设置
 */

import { display } from '../../display.js';
import { DoveClient } from '../../client.js';
import { loadConfig, saveConfig } from '../../lib/config.js';
import { select, input, PROVIDER_CHOICES } from '../../lib/interactive.js';
import { MODEL_ROLES, 默认推理模型, 默认快速模型, 默认视觉模型, normalizeProvider } from '@dove/common/模型配置.js';

export async function setIntentModel(provider, model, index) {
  const client = new DoveClient();
  
  // 如果指定了索引，从模型列表获取模型信息
  if (index !== undefined) {
    try {
      display.info(`正在查找索引 ${index} 对应的模型...`);
      
      // 获取所有提供商的模型列表
      const allModels = await client.getModelList();
      const providers = allModels.providers || {};
      
      // 构建带索引的模型列表
      let currentIndex = 1;
      let foundModel = null;
      
      for (const [prov, models] of Object.entries(providers)) {
        for (const m of models) {
          if (currentIndex === index) {
            foundModel = { provider: prov, model: m.name };
            break;
          }
          currentIndex++;
        }
        if (foundModel) break;
      }
      
      if (!foundModel) {
        display.error(`索引 ${index} 超出范围`);
        display.info('请使用 dove model list 查看模型列表');
        return;
      }
      
      // 设置模型
      const result = await client.setModelSettings({ intentModel: foundModel });
      display.success(`已设置意图识别模型: ${foundModel.provider}/${foundModel.model}`);
      display.info('意图识别模型已更新，新设置将在下次对话时生效');
      return;
      
    } catch (err) {
      display.error(`获取模型列表失败: ${err.message}`);
      display.info('请先刷新模型列表: dove model refresh');
      return;
    }
  }
  
  // 如果没有提供参数，显示当前配置
  if (!provider && !model) {
    try {
      const settings = await client.getModelSettings();
      
      console.log('');
      display.title('意图识别模型配置');
      console.log('');
      
      if (settings.intentModel) {
        console.log(`  提供商: ${settings.intentModel.provider}`);
        console.log(`  模型:   ${settings.intentModel.model}`);
      } else {
        console.log('  未设置，将使用默认配置');
        console.log('  默认提供商: 百炼');
        console.log('  默认模型: qwen3.5-flash');
      }
      console.log('');
      display.info('设置方式:');
      console.log('  dove config intent-model --index <序号>            # 通过索引设置');
      console.log('  dove config intent-model --provider 百炼 --model qwen3.5-flash');
      console.log('');
      display.info('使用 dove model list -p 百炼 查看模型列表和索引');
    } catch (err) {
      display.error(`获取配置失败: ${err.message}`);
    }
    return;
  }
  
  // 交互式输入
  if (!provider || !model) {
    provider = await select('选择意图识别模型提供商', [
      ...PROVIDER_CHOICES,
      { name: '其他 (自定义)', value: 'custom' }
    ], provider);
    if (provider === 'custom') {
      provider = await input('输入提供商名称');
    }
    model = await input('输入模型名称', model || 默认快速模型);
  }
  
  // 归一化提供商名称
  const normalizedProvider = normalizeProvider(provider);
  
  try {
    const result = await client.setModelSettings({
      intentModel: {
        provider: normalizedProvider,
        model
      }
    });
    
    display.success(result.message);
    display.info('意图识别模型已更新，新设置将在下次对话时生效');
  } catch (err) {
    display.error(`设置失败: ${err.message}`);
  }
}

// ==================== 多角色模型配置 ====================

/**
 * 角色名称映射（从 common/模型配置.js 统一导入，不再硬编码）
 * 修改默认值请编辑 common/模型配置.js
 */

/**
 * 设置或查看指定角色的模型配置
 * @param {string} role - 模型角色键名
 * @param {string} provider - 提供商
 * @param {string} model - 模型名
 * @param {number} index - 模型索引号
 */
export async function setModelRole(role, provider, model, index) {
  const roleInfo = MODEL_ROLES[role];
  if (!roleInfo) {
    display.error(`未知的模型角色: ${role}`);
    return;
  }
  const client = new DoveClient();
  
  // 如果指定了索引，从模型列表获取模型信息
  if (index !== undefined) {
    try {
      display.info(`正在查找索引 ${index} 对应的模型...`);
      const allModels = await client.getModelList();
      const providers = allModels.providers || {};
      let currentIndex = 1;
      let foundModel = null;
      for (const [prov, models] of Object.entries(providers)) {
        for (const m of models) {
          if (currentIndex === index) {
            foundModel = { provider: prov, model: m.name };
            break;
          }
          currentIndex++;
        }
        if (foundModel) break;
      }
      if (!foundModel) {
        display.error(`索引 ${index} 超出范围`);
        display.info('请使用 dove model list 查看模型列表');
        return;
      }
      const result = await client.setModelSettings({ [role]: foundModel });
      display.success(`已设置${roleInfo.name}模型: ${foundModel.provider}/${foundModel.model}`);
      display.info('模型配置已更新，新设置将在下次对话时生效');
      return;
    } catch (err) {
      display.error(`获取模型列表失败: ${err.message}`);
      display.info('请先刷新模型列表: dove model refresh');
      return;
    }
  }
  
  // 如果没有提供参数，显示当前配置
  if (!provider && !model) {
    try {
      const settings = await client.getModelSettings();
      console.log('');
      display.title(`${roleInfo.name}模型配置`);
      console.log('');
      if (settings[role]) {
        const s = settings[role];
        console.log(`  提供商: ${s.provider}`);
        console.log(`  模型:   ${s.model}`);
        if (s._source) console.log(`  来源:   ${s._source === 'user' ? '用户配置' : s._source === 'admin' ? '管理员默认' : '系统默认'}`);
      } else {
        console.log(`  未设置，将使用默认配置`);
        console.log(`  默认提供商: ${roleInfo.provider}`);
        console.log(`  默认模型: ${roleInfo.model}`);
      }
      console.log('');
      display.info('设置方式:');
      console.log(`  dove config ${role.replace(/([A-Z])/g, '-$1').toLowerCase()} --index <序号>`);
      console.log(`  dove config ${role.replace(/([A-Z])/g, '-$1').toLowerCase()} --provider <提供商> --model <模型名>`);
    } catch (err) {
      display.error(`获取配置失败: ${err.message}`);
    }
    return;
  }
  
  // 交互式输入
  if (!provider || !model) {
    provider = await select(`选择${roleInfo.name}模型提供商`, [
      ...PROVIDER_CHOICES,
      { name: '其他 (自定义)', value: 'custom' }
    ], provider);
    if (provider === 'custom') {
      provider = await input('输入提供商名称');
    }
    model = await input('输入模型名称', model || roleInfo.model);
  }
  
  // 归一化提供商名称
  const normalizedProvider = normalizeProvider(provider);
  
  try {
    const result = await client.setModelSettings({
      [role]: { provider: normalizedProvider, model }
    });
    display.success(result.message || `已设置${roleInfo.name}模型: ${normalizedProvider}/${model}`);
    display.info('模型配置已更新，新设置将在下次对话时生效');
  } catch (err) {
    display.error(`设置失败: ${err.message}`);
  }
}

/**
 * 查看所有模型配置总览
 */
export async function showModelSettings() {
  const client = new DoveClient();
  try {
    const settings = await client.getModelSettings();
    console.log('');
    display.title('模型配置总览');
    console.log('');
    
    const sourceLabel = (s) => {
      if (s === 'user') return '(用户配置)';
      if (s === 'admin') return '(管理员默认)';
      return '(系统默认)';
    };
    
    for (const [role, info] of Object.entries(MODEL_ROLES)) {
      const s = settings[role];
      if (s) {
        console.log(`  ${info.name}:`);
        console.log(`    提供商: ${s.provider}  模型: ${s.model}  ${sourceLabel(s._source)}`);
      } else {
        console.log(`  ${info.name}: 未配置 (使用默认: ${info.provider}/${info.model})`);
      }
    }
    console.log('');
    display.info('优先级: 用户配置 > 管理员默认 > 系统默认');
    console.log('');
    display.info('设置命令:');
    console.log('  dove config intent-model --provider <提供商> --model <模型名>');
    console.log('  dove config reasoning-model --provider <提供商> --model <模型名>');
    console.log('  dove config planning-model --provider <提供商> --model <模型名>');
    console.log('  dove config vision-model --provider <提供商> --model <模型名>');
    console.log('  dove config flash-model --provider <提供商> --model <模型名>');
  } catch (err) {
    display.error(`获取配置失败: ${err.message}`);
  }
}

/**
 * 查看或设置全局默认模型（超管专用）
 */
export async function setModelDefaults(provider, model, index, role = null) {
  const client = new AdminClient();
  
  // 检查是否有管理员权限
  if (!client.token && !client.config?.token) {
    display.error('此命令需要管理员登录');
    display.info('请先使用 dove login --admin 登录管理员账号');
    return;
  }
  
  // 没有参数时，显示当前全局默认
  if (!provider && !model && index === undefined) {
    try {
      const defaults = await client.getModelDefaults();
      console.log('');
      display.title('全局默认模型配置（超管）');
      console.log('');
      
      if (defaults && Object.keys(defaults).length > 0) {
        for (const [role, info] of Object.entries(MODEL_ROLES)) {
          const s = defaults[role];
          if (s) {
            console.log(`  ${info.name}: ${s.provider}/${s.model}`);
          } else {
            console.log(`  ${info.name}: 未设置 (使用系统默认: ${info.provider}/${info.model})`);
          }
        }
      } else {
        console.log('  未设置任何全局默认，所有用户使用系统硬编码默认值');
      }
      console.log('');
      display.info('设置方式:');
      console.log('  dove config model-defaults --provider 百炼 --model qwen3-max');
      console.log('  (设置后，未单独配置的用户将自动继承此默认值)');
    } catch (err) {
      display.error(`获取配置失败: ${err.message}`);
    }
    return;
  }
  
  // 设置全局默认模型
  // 确定要设置的角色
  let settingRole = role || 'reasoningModel';
  // 验证角色有效性
  if (!MODEL_ROLES[settingRole]) {
    display.error(`无效的角色: ${settingRole}`);
    display.info(`有效角色: ${Object.keys(MODEL_ROLES).join(', ')}`);
    return;
  }
  let foundProvider = provider;
  let foundModel = model;
  
  if (index !== undefined) {
    try {
      display.info(`正在查找索引 ${index} 对应的模型...`);
      const allModels = await client.getModelList();
      const providers = allModels.providers || {};
      let currentIndex = 1;
      let found = null;
      for (const [prov, models] of Object.entries(providers)) {
        for (const m of models) {
          if (currentIndex === index) {
            found = { provider: prov, model: m.name };
            break;
          }
          currentIndex++;
        }
        if (found) break;
      }
      if (!found) {
        display.error(`索引 ${index} 超出范围`);
        display.info('请使用 dove model list 查看模型列表');
        return;
      }
      foundProvider = found.provider;
      foundModel = found.model;
    } catch (err) {
      display.error(`获取模型列表失败: ${err.message}`);
      return;
    }
  }
  
  if (!foundProvider || !foundModel) {
    display.error('请指定 --provider 和 --model，或使用 --index 选择模型');
    return;
  }
  
  // 归一化提供商名称
  const normalizedProvider = normalizeProvider(foundProvider);
  
  try {
    const result = await client.setModelDefaults({
      [settingRole]: { provider: normalizedProvider, model: foundModel }
    });
    display.success(`已设置全局默认${MODEL_ROLES[settingRole].name}模型: ${normalizedProvider}/${foundModel}`);
    display.info('所有未单独配置的用户将自动继承此默认值');
  } catch (err) {
    display.error(`设置失败: ${err.message}`);
  }
}

