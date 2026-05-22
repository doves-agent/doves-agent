/**
 * 文件整理技能
 * 遍历目录 → LLM分类 → 移动/归类文件
 * Git记忆记录用户整理偏好
 */

import { readdir, mkdir, rename } from 'fs/promises';
import { join, extname, dirname } from 'path';
import { statSync } from 'fs';

export default {
  name: 'file_organize',
  description: '整理文件夹，自动分类和归类文件',
  category: '电脑操作',

  /**
   * 执行文件整理
   * @param {Object} params
   * @param {string} params.targetPath - 要整理的目录路径
   * @param {string} [params.strategy] - 整理策略: 'by_type' 按类型 | 'by_date' 按日期 | 'by_size' 按大小
   * @param {Object} context - 执行上下文
   */
  async execute(params, context) {
    const { targetPath, strategy = 'by_type' } = params;

    try {
      const entries = await readdir(targetPath, { withFileTypes: true });
      const files = entries.filter(e => e.isFile());

      if (files.length === 0) {
        return { success: true, message: '目录中没有需要整理的文件', filesCount: 0 };
      }

      // 按策略分组
      let groups = {};
      switch (strategy) {
        case 'by_type':
          groups = groupByType(files);
          break;
        case 'by_date':
          groups = groupByDate(files, targetPath);
          break;
        case 'by_size':
          groups = groupBySize(files, targetPath);
          break;
        default:
          groups = groupByType(files);
      }

      // 执行移动
      const results = [];
      for (const [category, categoryFiles] of Object.entries(groups)) {
        const categoryDir = join(targetPath, category);
        await mkdir(categoryDir, { recursive: true });

        for (const file of categoryFiles) {
          const srcPath = join(targetPath, file.name);
          const destPath = join(categoryDir, file.name);
          try {
            await rename(srcPath, destPath);
            results.push({ file: file.name, from: srcPath, to: destPath, status: 'moved' });
          } catch (err) {
            results.push({ file: file.name, from: srcPath, status: '失败', error: err.message });
          }
        }
      }

      // 记录整理偏好到Git记忆
      try {
        const Git记忆 = await import('../../../../tools/Git存储/记忆仓库.js');
        if (Git记忆.是否可用()) {
          await Git记忆.添加记忆({
            用户ID: context?.userId || 'default',
            类别: '经验记忆',
            内容: `文件整理: ${targetPath}, 策略: ${strategy}, ${files.length}个文件 → ${Object.keys(groups).length}个分类`,
            元数据: { type: 'file_organize', targetPath, strategy, fileCount: files.length },
          });
        }
      } catch { /* 记忆记录失败不阻塞 */ }

      return {
        success: true,
        targetPath,
        strategy,
        filesCount: files.length,
        categories: Object.keys(groups),
        results,
      };
    } catch (err) {
      return { success: false, error: err.message, targetPath };
    }
  },
};

/**
 * 按文件类型分组
 */
function groupByType(files) {
  const groups = {};

  const typeMap = {
    文档: ['.txt', '.md', '.doc', '.docx', '.pdf', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.json', '.xml', '.yaml', '.yml', '.log'],
    图片: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff', '.psd'],
    视频: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'],
    音频: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'],
    压缩包: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'],
    代码: ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.cs', '.vue', '.jsx', '.tsx'],
    可执行文件: ['.exe', '.msi', '.app', '.dmg', '.deb', '.rpm', '.sh', '.bat', '.cmd', '.ps1'],
    字体: ['.ttf', '.otf', '.woff', '.woff2', '.eot'],
  };

  for (const file of files) {
    const ext = extname(file.name).toLowerCase();
    let category = '其他';

    for (const [cat, exts] of Object.entries(typeMap)) {
      if (exts.includes(ext)) {
        category = cat;
        break;
      }
    }

    if (!groups[category]) groups[category] = [];
    groups[category].push(file);
  }

  return groups;
}

/**
 * 按修改日期分组（年-月）
 */
function groupByDate(files, basePath) {
  const groups = {};
  for (const file of files) {
    try {
      const stat = statSync(join(basePath, file.name));
      const date = stat.mtime;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(file);
    } catch {
      if (!groups['未知日期']) groups['未知日期'] = [];
      groups['未知日期'].push(file);
    }
  }
  return groups;
}

/**
 * 按文件大小分组
 */
function groupBySize(files, basePath) {
  const groups = { '小文件(<1MB)': [], '中等文件(1-10MB)': [], '大文件(10-100MB)': [], '超大文件(>100MB)': [] };
  for (const file of files) {
    try {
      const stat = statSync(join(basePath, file.name));
      const sizeMB = stat.size / (1024 * 1024);
      if (sizeMB < 1) groups['小文件(<1MB)'].push(file);
      else if (sizeMB < 10) groups['中等文件(1-10MB)'].push(file);
      else if (sizeMB < 100) groups['大文件(10-100MB)'].push(file);
      else groups['超大文件(>100MB)'].push(file);
    } catch {
      groups['小文件(<1MB)'].push(file);
    }
  }
  // 移除空组
  for (const key of Object.keys(groups)) {
    if (groups[key].length === 0) delete groups[key];
  }
  return groups;
}
