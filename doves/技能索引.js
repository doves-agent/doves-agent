/**
 * @file 技能索引
 * @description 支持分层查询的技能索引，解决技能发现问题
 * 
 * 三层结构：
 * - 第一层：分类摘要（给 FLASH 看，约 100 tokens）
 * - 第二层：分类下技能列表（给推理模型看，约 500 tokens）
 * - 第三层：完整 schema（执行时按需加载）
 */

import { 加载技能, 获取技能列表 } from './skills/index.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('技能索引', { 前缀: '[SkillIndex]', 级别: 'debug', 显示调用位置: true });

/**
 * 技能索引类
 */
class SkillIndex {
  constructor() {
    this._categories = null;
    this._categorySkills = null;
    this._fullSchema = null;
    this._initialized = false;
    this._技能管理器 = null;  // 可选：外部注入的技能管理器实例
  }

  /**
   * 设置技能管理器实例（供入口.js注入共享管理器）
   * @param {Object} manager - 技能管理器实例
   */
  setSkillManager(manager) {
    this._技能管理器 = manager;
  }

  /**
   * 获取技能名列表（优先注入的管理器，fallback到默认管理器）
   * @private
   */
  _获取技能名列表() {
    if (this._技能管理器 && typeof this._技能管理器.获取技能列表 === 'function') {
      return this._技能管理器.获取技能列表();
    }
    return 获取技能列表();
  }

  /**
   * 加载单个技能定义（优先注入的管理器）
   * @private
   */
  async _加载单个技能(技能名) {
    if (this._技能管理器 && this._技能管理器.已注册技能 instanceof Map) {
      return this._技能管理器.已注册技能.get(技能名) || null;
    }
    return await 加载技能(技能名);
  }

  /**
   * 初始化索引（加载所有技能）
   */
  async initialize() {
    if (this._initialized) {
      return;
    }

    try {
      // 加载所有技能（优先从注入的管理器获取）
      const skillNames = this._获取技能名列表();
      
      // 构建索引
      this._categories = {};
      this._categorySkills = {};
      this._fullSchema = {};

      for (const name of skillNames) {
        try {
          const skill = await this._加载单个技能(name);
          if (skill) {
            this._indexSkill(name, skill);
          }
        } catch (错误) {
          logger.error(`加载技能 ${name} 失败:`, 错误.message);
        }
      }

      this._initialized = true;
      logger.info(`初始化完成，共 ${skillNames.length} 个技能`);
    } catch (错误) {
      logger.error('初始化失败:', 错误.message);
      // 使用内置索引
      this._useBuiltinIndex();
    }
  }

  /**
   * 重新初始化索引（用于扩展包加载后刷新技能列表）
   * @param {Object} 技能管理器实例 - 可选，新的技能管理器
   */
  async reinitialize(技能管理器实例 = null) {
    if (技能管理器实例) {
      this.setSkillManager(技能管理器实例);
    }
    this._initialized = false;
    this._categories = null;
    this._categorySkills = null;
    this._fullSchema = null;
    await this.initialize();
  }

  /**
   * 使用内置索引（降级）
   * @private
   */
  _useBuiltinIndex() {
    this._categories = {
      '简单聊天': { count: 1, abilities: ['chat', 'greeting', 'qa', 'casual'], keywords: ['你好', '您好', 'hello', 'hi', '谢谢', '感谢', '好的', '嗯', 'ok'], canFlashReply: true },
      '文档处理': { count: 12, abilities: ['pdf', 'docx', 'xlsx', 'txt', 'pptx'] },
      '代码计算': { count: 8, abilities: ['code', 'calculator', 'math', 'python'] },
      '网络搜索': { count: 5, abilities: ['browser', 'http', 'search', 'web'] },
      '多媒体': { count: 6, abilities: ['image', 'audio', 'video', 'vision'] },
      '系统任务': { count: 4, abilities: ['resource', 'docker', 'ssh', 'process'] },
      '数据存储': { count: 5, abilities: ['database', 'mongodb', 'oss', 'memory'] },
      '翻译语言': { count: 3, abilities: ['translate', 'ocr', 'tts'] }
    };

    this._categorySkills = {
      '简单聊天': [
        { name: '聊天/简单', desc: '简单聊天对话', abilities: ['聊天', '问候', '问答'] },
        { name: '问答/基础', desc: '基础问答', abilities: ['问答', '知识'] }
      ],
      '文档处理': [
        { name: 'PDF/提取', desc: 'PDF文本和表格提取', abilities: ['OCR', '表格', 'pdf'] },
        { name: 'PDF/转换', desc: 'PDF转其他格式', abilities: ['格式转换', 'pdf'] },
        { name: 'Excel/解析', desc: 'Excel表格解析', abilities: ['表格', '数据', 'xlsx'] },
        { name: 'Excel/创建', desc: '创建Excel表格', abilities: ['表格', '创建', 'xlsx'] },
        { name: 'Word/读取', desc: 'Word文档读取', abilities: ['文档', 'docx'] },
        { name: '文本/读取', desc: '文本文件读取', abilities: ['文本', 'txt'] }
      ],
      '代码计算': [
        { name: '代码/执行', desc: '代码执行', abilities: ['编程', 'python', 'javascript'] },
        { name: '计算器', desc: '数学计算', abilities: ['计算', '数学'] },
        { name: '数学/求解', desc: '数学问题求解', abilities: ['数学', '推理'] }
      ],
      '网络搜索': [
        { name: '浏览器/导航', desc: '浏览器导航', abilities: ['浏览器', '网页'] },
        { name: '浏览器/截图', desc: '网页截图', abilities: ['浏览器', '截图'] },
        { name: 'HTTP/请求', desc: 'HTTP请求', abilities: ['HTTP', 'API'] },
        { name: '网页/搜索', desc: '网页搜索', abilities: ['搜索', '网络'] }
      ],
      '多媒体': [
        { name: '图片/生成', desc: '图片生成', abilities: ['图片', '生成', 'AI'] },
        { name: '图片/编辑', desc: '图片编辑', abilities: ['图片', '编辑'] },
        { name: '音频/合成', desc: '语音合成', abilities: ['语音', 'TTS'] },
        { name: '音频/识别', desc: '语音识别', abilities: ['语音', 'ASR'] },
        { name: '视觉/分析', desc: '图片理解', abilities: ['视觉', 'OCR', '理解'] }
      ],
      '系统任务': [
        { name: '资源/分配', desc: '资源分配', abilities: ['系统', '资源'] },
        { name: 'Docker/管理', desc: 'Docker管理', abilities: ['Docker', '容器'] },
        { name: 'SSH/执行', desc: 'SSH执行', abilities: ['SSH', '远程'] },
        { name: '进程/管理', desc: '进程管理', abilities: ['进程', '系统'] }
      ],
      '数据存储': [
        { name: 'MongoDB/查询', desc: 'MongoDB查询', abilities: ['数据库', 'MongoDB'] },
        { name: 'OSS/上传', desc: 'OSS上传', abilities: ['OSS', '存储'] },
        { name: '记忆/搜索', desc: 'Git记忆搜索', abilities: ['记忆', '向量'] }
      ],
      '翻译语言': [
        { name: '翻译/文本', desc: '文本翻译', abilities: ['翻译', '多语言'] },
        { name: 'OCR/识别', desc: 'OCR识别', abilities: ['OCR', '图片'] },
        { name: '语音/合成', desc: '语音合成', abilities: ['TTS', '语音'] }
      ]
    };

    this._fullSchema = {};
    this._initialized = true;
  }

  /**
   * 索引单个技能
   * @private
   */
  _indexSkill(name, skill) {
    const category = skill.category || this._guessCategory(name);
    const abilities = skill.abilities || [name];
    const desc = skill.description || name;

    // 更新分类
    if (!this._categories[category]) {
      this._categories[category] = { count: 0, abilities: [] };
    }
    this._categories[category].count++;
    for (const a of abilities) {
      if (!this._categories[category].abilities.includes(a)) {
        this._categories[category].abilities.push(a);
      }
    }

    // 更新分类技能
    if (!this._categorySkills[category]) {
      this._categorySkills[category] = [];
    }
    this._categorySkills[category].push({
      name,
      desc,
      abilities
    });

    // 更新完整 schema
    this._fullSchema[name] = {
      parameters: skill.parameters,
      description: skill.description,
      examples: skill.examples || []
    };
  }

  /**
   * 猜测技能分类
   * @private
   */
  _guessCategory(skillName) {
    const 关键词映射 = {
      'pdf': '文档处理',
      'docx': '文档处理',
      'xlsx': '文档处理',
      'txt': '文档处理',
      'ppt': '文档处理',
      'document': '文档处理',
      '文档': '文档处理',
      '文件': '文档处理',
      'code': '代码计算',
      'calculator': '代码计算',
      'math': '代码计算',
      'python': '代码计算',
      '代码': '代码计算',
      '计算': '代码计算',
      '数学': '代码计算',
      'browser': '网络搜索',
      'web': '网络搜索',
      'http': '网络搜索',
      'search': '网络搜索',
      '浏览器': '网络搜索',
      '网页': '网络搜索',
      '搜索': '网络搜索',
      'image': '多媒体',
      'video': '多媒体',
      'audio': '多媒体',
      'vision': '多媒体',
      'tts': '多媒体',
      'asr': '多媒体',
      '图片': '多媒体',
      '视频': '多媒体',
      '音频': '多媒体',
      '视觉': '多媒体',
      '语音': '多媒体',
      'docker': '系统任务',
      'ssh': '系统任务',
      'process': '系统任务',
      'resource': '系统任务',
      '系统': '系统任务',
      '资源': '系统任务',
      '进程': '系统任务',
      '远程': '系统任务',
      'mongo': '数据存储',
      'oss': '数据存储',
      'storage': '数据存储',
      'memory': '数据存储',
      '数据': '数据存储',
      '存储': '数据存储',
      '记忆': '数据存储',
      'translate': '翻译语言',
      'ocr': '翻译语言',
      '翻译': '翻译语言'
    };

    const name = skillName.toLowerCase();
    for (const [关键词, 分类] of Object.entries(关键词映射)) {
      if (name.includes(关键词)) {
        return 分类;
      }
    }

    return '其他';
  }

  /**
   * 获取分类摘要（第一层）
   * @returns {Object} 分类摘要
   */
  getCategories() {
    if (!this._initialized) {
      this._useBuiltinIndex();
    }
    return this._categories;
  }

  /**
   * 获取分类下的技能列表（第二层）
   * @param {string} category - 分类名称
   * @returns {Array} 技能列表
   */
  getCategorySkills(category) {
    if (!this._initialized) {
      this._useBuiltinIndex();
    }
    return this._categorySkills[category] || [];
  }

  /**
   * 获取技能完整 schema（第三层）
   * @param {string} skillName - 技能名称
   * @returns {Object} 完整 schema
   */
  getFullSchema(skillName) {
    if (!this._initialized) {
      this._useBuiltinIndex();
    }
    return this._fullSchema[skillName] || null;
  }

  /**
   * 根据能力匹配技能
   * @param {string} category - 分类名称
   * @param {Array} abilities - 能力列表
   * @returns {Array} 匹配的技能
   */
  matchSkills(category, abilities) {
    const categorySkills = this.getCategorySkills(category);
    if (!categorySkills.length || !abilities?.length) {
      return [];
    }

    return categorySkills.filter(skill => {
      const skillAbilities = skill.abilities.map(a => a.toLowerCase());
      return abilities.some(a => skillAbilities.includes(a.toLowerCase()));
    });
  }

  /**
   * 搜索技能（跨分类）
   * @param {string} keyword - 关键词
   * @returns {Array} 匹配的技能
   */
  searchSkills(keyword) {
    if (!this._initialized) {
      this._useBuiltinIndex();
    }

    const results = [];
    const kw = keyword.toLowerCase();

    for (const [category, skills] of Object.entries(this._categorySkills)) {
      for (const skill of skills) {
        if (skill.name.toLowerCase().includes(kw) ||
            skill.desc.toLowerCase().includes(kw) ||
            skill.abilities.some(a => a.toLowerCase().includes(kw))) {
          results.push({ ...skill, category });
        }
      }
    }

    return results;
  }

  /**
   * 获取索引统计
   * @returns {Object} 统计信息
   */
  getStats() {
    if (!this._initialized) {
      this._useBuiltinIndex();
    }

    const stats = {
      categories: Object.keys(this._categories).length,
      totalSkills: 0,
      byCategory: {}
    };

    for (const [category, info] of Object.entries(this._categories)) {
      stats.byCategory[category] = info.count;
      stats.totalSkills += info.count;
    }

    return stats;
  }

  /**
   * 生成第一层索引描述（给 FLASH 的提示词）
   * @returns {string} 索引描述
   */
  generateCategoriesPrompt() {
    const categories = this.getCategories();
    return Object.entries(categories)
      .map(([name, info]) => `- ${name}: ${info.abilities.join(', ')} (${info.count}个技能)`)
      .join('\n');
  }

  /**
   * 生成第二层索引描述（给推理模型的提示词）
   * @param {string} category - 分类名称
   * @returns {string} 索引描述
   */
  generateSkillsPrompt(category) {
    const skills = this.getCategorySkills(category);
    return skills
      .map(s => `- ${s.name}: ${s.desc} (能力: ${s.abilities.join(', ')})`)
      .join('\n');
  }
}

// 单例
let skillIndexInstance = null;

/**
 * 获取技能索引实例
 * @returns {SkillIndex}
 */
export function getSkillIndex() {
  if (!skillIndexInstance) {
    skillIndexInstance = new SkillIndex();
  }
  return skillIndexInstance;
}

// 导出类和实例
export { SkillIndex };
export default SkillIndex;
