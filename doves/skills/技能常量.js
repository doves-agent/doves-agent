/**
 * @file skills/技能常量
 * @description 技能分类定义、已实现技能列表与目录扫描函数
 */

import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('技能常量', { 前缀: '[技能常量]', 级别: 'debug', 显示调用位置: true });

const __dirname = dirname(fileURLToPath(import.meta.url));

// 技能分类
export const 技能分类 = {
  文档处理: ['PDF生成', '文件操作'],
  代码计算: ['代码/执行', '计算器', 'Git仓库分析'],
  网络搜索: ['网络搜索', 'HTTP请求', '浏览器控制'],
  多媒体: ['图片', '视觉', '音频', '视频'],
  记忆系统: ['记忆', '模型整理'],
  外部服务: ['MCP客户端', 'Docker管理', 'SSH远程控制'],
  IM通讯: ['IM文件发送'],
  解析器: ['归档', '代码', '配置', '数据', '电子书'],
  系统任务: ['资源分配', '结果验证', '备份']
};

// 已实现的技能列表（可自动加载）
export const 已实现技能 = [
  '浏览器控制',      // 浏览器控制
  'SSH远程控制',      // SSH远程控制
  'Docker管理',       // Docker管理
  '文件操作',         // 文件操作
  '资源分配',         // 资源分配
  'HTTP请求',         // HTTP请求
  '网络搜索',         // 网络搜索
  '计算器',           // 计算器
  '代码/执行',        // 代码执行
  'PDF生成',          // PDF生成
  '结果验证',         // 结果验证
  '模型整理',         // 模型整理
  'IM文件发送',       // IM文件发送
  'Git仓库分析',      // Git仓库智能分析
  'element_extract',  // 元素拆解（识图→拆解→打包）
];

// ==================== 动态技能注册系统（扩展包支持） ====================
// 扩展技能：Map<技能名, { 分类, 扩展包名 }>
const _扩展技能 = new Map();

/**
 * 注册扩展技能（供扩展加载器调用）
 * @param {string} 技能名 - 技能标识
 * @param {string} 分类 - 技能分类（可选）
 * @param {string} 扩展包名 - 来源扩展包
 */
export function 注册扩展技能(技能名, 分类 = null, 扩展包名 = '') {
  _扩展技能.set(技能名, { 分类, 扩展包名 });
  if (分类) {
    if (!技能分类[分类]) 技能分类[分类] = [];
    if (!技能分类[分类].includes(技能名)) 技能分类[分类].push(技能名);
  }
  logger.info(`注册扩展技能: ${技能名} (来自 ${扩展包名})`);
}

/**
 * 注销扩展技能（供扩展加载器卸载时调用）
 * @param {string} 扩展包名 - 来源扩展包
 */
export function 注销扩展技能(扩展包名) {
  for (const [技能名, 数据] of _扩展技能) {
    if (数据.扩展包名 === 扩展包名) {
      _扩展技能.delete(技能名);
      // 从分类中移除
      if (数据.分类 && 技能分类[数据.分类]) {
        const idx = 技能分类[数据.分类].indexOf(技能名);
        if (idx >= 0) 技能分类[数据.分类].splice(idx, 1);
      }
    }
  }
}

/**
 * 获取所有已实现技能（含扩展）
 * @returns {string[]} 技能名列表
 */
export function 获取所有已实现技能() {
  return [...已实现技能, ..._扩展技能.keys()];
}

/**
 * 扫描 skills 目录获取可用技能
 * @param {string} 目录路径 - 可选，指定要扫描的目录，默认为当前 skills 目录
 * @returns {Array} 可用技能列表
 */
export function 扫描技能目录(目录路径 = null) {
  const skillsDir = 目录路径 || __dirname;
  const 可用技能 = [];
  
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // 检查是否有 index.js（一级技能）
        const indexPath = join(skillsDir, entry.name, 'index.js');
        if (existsSync(indexPath)) {
          可用技能.push({
            名称: entry.name,
            路径: indexPath,
            目录: skillsDir
          });
        } else {
          // 检查是否有二级技能目录（如 code/execute/index.js）
          try {
            const subEntries = readdirSync(join(skillsDir, entry.name), { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (subEntry.isDirectory()) {
                const subIndexPath = join(skillsDir, entry.name, subEntry.name, 'index.js');
                if (existsSync(subIndexPath)) {
                  可用技能.push({
                    名称: `${entry.name}/${subEntry.name}`,
                    路径: subIndexPath,
                    目录: skillsDir
                  });
                }
              }
            }
          } catch (subErr) {
            // 忽略子目录扫描错误
          }
        }
      }
    }
    
    logger.info(`扫描 ${skillsDir} 发现 ${可用技能.length} 个可用技能`);
  } catch (error) {
    logger.error(`扫描技能目录失败: ${error.message}`);
  }
  
  return 可用技能;
}

/**
 * 扫描多个技能目录
 * @param {Array} 目录列表 - 技能目录列表
 * @returns {Array} 合并后的可用技能列表
 */
export function 扫描多个技能目录(目录列表 = []) {
  const 所有技能 = [];
  const 已见名称 = new Set();
  
  // 始终包含默认 skills 目录
  const 默认技能 = 扫描技能目录(__dirname);
  for (const 技能 of 默认技能) {
    所有技能.push(技能);
    已见名称.add(技能.名称);
  }
  
  // 扫描额外目录
  for (const 目录 of 目录列表) {
    try {
      if (!existsSync(目录)) {
        logger.warn(`技能目录不存在: ${目录}`);
        continue;
      }
      
      const 技能列表 = 扫描技能目录(目录);
      for (const 技能 of 技能列表) {
        if (!已见名称.has(技能.名称)) {
          所有技能.push(技能);
          已见名称.add(技能.名称);
        } else {
          logger.warn(`跳过重复技能: ${技能.名称} (已在其他目录加载)`);
        }
      }
    } catch (error) {
      logger.error(`扫描目录 ${目录} 失败: ${error.message}`);
    }
  }
  
  return 所有技能;
}
