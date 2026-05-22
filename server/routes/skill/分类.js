/**
 * 技能分类模块
 * 职责：技能分类定义、匹配、默认列表
 * 
 * 从 server/routes/skill.js 拆分，遵循KISS原则
 */

// 技能分类定义
export const 技能分类 = {
  文档处理: ['pdf', 'docx', 'xlsx', 'pptx', '文件操作'],
  代码计算: ['代码/执行', '计算器', 'math'],
  网络搜索: ['网络搜索', 'HTTP请求', '浏览器控制'],
  多媒体: ['image', 'vision', 'audio', 'video'],
  记忆系统: ['memory', 'git_memory'],
  外部服务: ['mcp_client', 'Docker管理', 'SSH远程控制'],
  解析器: ['archive', 'code', 'config', 'data', 'ebook'],
  系统任务: ['资源分配', 'cleanup', 'backup']
};

/**
 * 获取技能分类
 */
export function getCategoryForSkill(skillName) {
  for (const [分类, 技能列表] of Object.entries(技能分类)) {
    if (技能列表.includes(skillName)) {
      return 分类;
    }
  }
  return null;
}

/**
 * 获取默认技能列表
 */
export function getDefaultSkillList() {
  const list = [];
  for (const [分类, 技能列表] of Object.entries(技能分类)) {
    for (const 名称 of 技能列表) {
      list.push({ 名称, 分类, 来源: '目录' });
    }
  }
  return list;
}
