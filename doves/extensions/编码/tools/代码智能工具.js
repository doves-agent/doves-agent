/**
 * @file tools/代码智能工具
 * @description LSP 驱动的代码智能分析工具集
 * 
 * 通过 LSP 客户端提供精确的 AST 级代码分析能力，
 * 替代正则匹配的旧 code_symbols，覆盖更多语言、更精确。
 * 
 * 注册工具：
 *   - code_goto_definition    : LSP 跳转到符号定义
 *   - code_find_references    : LSP 查找符号所有引用
 *   - code_document_symbols   : LSP 精确提取文档符号（含层级）
 *   - code_find_implementations: LSP 查找接口/抽象类的实现
 *   - code_call_hierarchy     : LSP 调用层级分析
 *   - code_hover_info         : LSP 悬停信息（类型+文档）
 * 
 * 导出格式（兼容扩展加载器）：
 *   extTools                  : 工具定义数组
 *   handleExtTool             : 工具调用处理器
 *   extToolCategories         : 工具分类
 *   extToolAbilityMap         : 工具能力映射
 *   extToolSafetyLevels       : 工具安全分级
 */

import { globalLSPManager } from './LSP客户端.js';

// ==============================
// 工具定义
// ==============================

export const extTools = [
  {
    name: 'code_goto_definition',
    description: 'LSP 跳转到符号定义。在指定文件的行列位置，找到该符号的定义（支持跨文件跳转）。适合场景：理解某个函数/类/变量是从哪里导入或定义的。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '源文件路径（必填，绝对路径或相对工作目录的路径）' },
        line: { type: 'number', description: '符号所在行号（从1开始，必填）' },
        character: { type: 'number', description: '符号所在列号（从1开始，必填。不确定写1即可）' },
      },
      required: ['path', 'line', 'character']
    }
  },
  {
    name: 'code_find_references',
    description: 'LSP 查找符号所有引用。在指定文件的行列位置，查找该符号在整个项目中的所有引用点。适合场景：重构前评估影响范围、查找某个函数在哪里被调用。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '源文件路径（必填）' },
        line: { type: 'number', description: '符号所在行号（从1开始，必填）' },
        character: { type: 'number', description: '符号所在列号（从1开始，必填。不确定写1即可）' },
        includeDeclaration: { type: 'boolean', description: '是否包含声明处（默认false）' },
      },
      required: ['path', 'line', 'character']
    }
  },
  {
    name: 'code_document_symbols',
    description: 'LSP 精确提取文件符号定义（函数、类、接口、方法、属性）。包含层级关系和方法签名。适合场景：了解文件结构、查看类有哪些方法、找到某个函数定义位置。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必填）' },
        flatten: { type: 'boolean', description: '是否展平嵌套结构（默认false返回层级树，true返回扁平列表）' },
      },
      required: ['path']
    }
  },
  {
    name: 'code_find_implementations',
    description: 'LSP 查找接口/抽象类的所有实现。在指定文件的行列位置，如果该符号是接口或抽象类，返回所有实现类/方法的位置。适合场景：查看哪个类实现了某个接口、找到抽象方法的所有具体实现。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '源文件路径（必填）' },
        line: { type: 'number', description: '接口/抽象方法所在行号（从1开始，必填）' },
        character: { type: 'number', description: '列号（从1开始，必填。不确定写1即可）' },
      },
      required: ['path', 'line', 'character']
    }
  },
  {
    name: 'code_call_hierarchy',
    description: 'LSP 调用层级分析。分析符号的入调用（谁调用了它）和出调用（它调用了谁），理解函数调用关系。适合场景：重构前评估影响范围、理解函数调用链路、调试时找出调用来源。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '源文件路径（必填）' },
        line: { type: 'number', description: '符号所在行号（从1开始，必填）' },
        character: { type: 'number', description: '列号（从1开始，必填。不确定写1即可）' },
        direction: { type: 'string', enum: ['both', 'incoming', 'outgoing'], description: '分析方向（默认both；incoming=谁调用了它；outgoing=它调用了谁）' },
      },
      required: ['path', 'line', 'character']
    }
  },
  {
    name: 'code_hover_info',
    description: 'LSP 悬停信息。获取符号的类型签名和文档注释，类似 IDE 鼠标悬停效果。适合场景：查看函数返回类型、变量类型、查看文档注释。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（必填）' },
        line: { type: 'number', description: '行号（从1开始，必填）' },
        character: { type: 'number', description: '列号（从1开始，必填。不确定写1即可）' },
      },
      required: ['path', 'line', 'character']
    }
  },
];

// ==============================
// 工具调用处理器
// ==============================

const text = (obj) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }]
});
/**
 * 读取文件内容用于返回上下文
 */
async function readFileLines(filePath, startLine, endLine) {
  try {
    const fs = await import('fs/promises');
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(Math.max(0, startLine - 1), endLine).join('\n');
  } catch {
    return '';
  }
}

export async function handleExtTool(name, args) {
  try {
    switch (name) {

      // ===== 1. LSP 跳转到定义 =====
      case 'code_goto_definition': {
        const { path: filePath, line, character } = args;
        const locations = await globalLSPManager.getDefinition(filePath, line, character);
        if (!locations || locations.length === 0) {
          return text({ found: false, message: '未找到符号定义' });
        }
        // 读取上下文代码
        const resultLocations = await Promise.all(locations.map(async (loc) => {
          let contextCode = '';
          if (loc.range && loc.filePath) {
            contextCode = await readFileLines(loc.filePath, loc.range.start.line, loc.range.end.line);
          }
          return { ...loc, contextCode: contextCode || '' };
        }));
        return text({
          tool: 'code_goto_definition',
          found: true,
          count: resultLocations.length,
          definitions: resultLocations,
        });
      }

      // ===== 2. LSP 查找引用 =====
      case 'code_find_references': {
        const { path: filePath, line, character, includeDeclaration = false } = args;
        const references = await globalLSPManager.findReferences(filePath, line, character, includeDeclaration);
        if (!references || references.length === 0) {
          return text({ found: false, message: '未找到引用' });
        }
        // 按文件分组
        const grouped = {};
        for (const ref of references) {
          const fp = ref.filePath || 'unknown';
          if (!grouped[fp]) grouped[fp] = [];
          let contextCode = '';
          if (ref.range) {
            contextCode = await readFileLines(fp, ref.range.start.line, ref.range.start.line);
          }
          grouped[fp].push({
            line: ref.range?.start?.line || 0,
            character: ref.range?.start?.character || 0,
            contextCode: contextCode.trim(),
          });
        }
        return text({
          tool: 'code_find_references',
          found: true,
          totalCount: references.length,
          fileCount: Object.keys(grouped).length,
          byFile: grouped,
          references: references.map(r => ({
            filePath: r.filePath,
            line: r.range?.start?.line || 0,
            character: r.range?.start?.character || 0,
          })),
        });
      }

      // ===== 3. LSP 文档符号 =====
      case 'code_document_symbols': {
        const { path: filePath, flatten = false } = args;
        const symbols = await globalLSPManager.getDocumentSymbols(filePath);
        if (!symbols || symbols.length === 0) {
          return text({ found: false, message: '未找到符号或文件为空' });
        }

        if (flatten) {
          // 展平：递归展开所有子符号
          const flatList = [];
          function flattenSymbols(symList, parentName = '') {
            for (const sym of symList) {
              const fullName = sym.fullName || (parentName ? `${parentName}.${sym.name}` : sym.name);
              flatList.push({
                name: sym.name,
                fullName,
                kind: sym.kind,
                detail: sym.detail,
                range: sym.selectionRange || sym.range,
                containerName: parentName,
              });
              if (sym.children && sym.children.length > 0) {
                flattenSymbols(sym.children, fullName);
              }
            }
          }
          flattenSymbols(symbols);
          return text({
            tool: 'code_document_symbols',
            path: filePath,
            total: flatList.length,
            flatten: true,
            symbols: flatList,
          });
        }

        return text({
          tool: 'code_document_symbols',
          path: filePath,
          total: countSymbols(symbols),
          flatten: false,
          symbols,
        });
      }

      // ===== 4. LSP 查找实现 =====
      case 'code_find_implementations': {
        const { path: filePath, line, character } = args;
        const implementations = await globalLSPManager.findImplementations(filePath, line, character);
        if (!implementations || implementations.length === 0) {
          return text({ found: false, message: '未找到实现或该符号不是接口/抽象类' });
        }
        const resultImpls = await Promise.all(implementations.map(async (impl) => {
          let contextCode = '';
          if (impl.range && impl.filePath) {
            contextCode = await readFileLines(impl.filePath, impl.range.start.line, impl.range.start.line);
          }
          return { ...impl, contextCode: contextCode.trim() };
        }));
        return text({
          tool: 'code_find_implementations',
          found: true,
          count: resultImpls.length,
          implementations: resultImpls,
        });
      }

      // ===== 5. LSP 调用层级 =====
      case 'code_call_hierarchy': {
        const { path: filePath, line, character, direction = 'both' } = args;
        const hierarchy = await globalLSPManager.getCallHierarchy(filePath, line, character);
        if (!hierarchy.item) {
          return text({ found: false, message: '未找到符号或该符号不支持调用层级分析' });
        }

        const result = {
          tool: 'code_call_hierarchy',
          found: true,
          symbol: hierarchy.item,
        };

        if (direction === 'both' || direction === 'incoming') {
          result.incomingCalls = hierarchy.incoming;
          result.incomingCount = hierarchy.incoming.length;
        }
        if (direction === 'both' || direction === 'outgoing') {
          result.outgoingCalls = hierarchy.outgoing;
          result.outgoingCount = hierarchy.outgoing.length;
        }

        return text(result);
      }

      // ===== 6. LSP 悬停信息 =====
      case 'code_hover_info': {
        const { path: filePath, line, character } = args;
        const hover = await globalLSPManager.getHoverInfo(filePath, line, character);
        if (!hover) {
          return text({ found: false, message: '该位置无附加信息' });
        }
        return text({
          tool: 'code_hover_info',
          found: true,
          contents: hover.contents,
          range: hover.range,
        });
      }

      default:
        return null; /* 不处理此工具，交给链中下一个处理器 */
    }
  } catch (e) {
    return text({ error: `[LSP ${name}] ${e.message}`, level: 'error' });
  }
}

/**
 * 递归计算符号总数
 */
function countSymbols(symbols) {
  let count = 0;
  for (const sym of symbols) {
    count++;
    if (sym.children) count += countSymbols(sym.children);
  }
  return count;
}

// ==============================
// 工具分类
// ==============================

export const extToolCategories = {
  代码工具: ['code_goto_definition', 'code_find_references', 'code_document_symbols', 'code_find_implementations', 'code_call_hierarchy', 'code_hover_info']
};

// ==============================
// 工具能力映射
// ==============================

export const extToolAbilityMap = {
  code_goto_definition: ['编程', '代码', '导航', '符号', '分析'],
  code_find_references: ['编程', '代码', '搜索', '引用', '分析'],
  code_document_symbols: ['编程', '代码', '符号', '提取', '分析'],
  code_find_implementations: ['编程', '代码', '接口', '实现', '分析'],
  code_call_hierarchy: ['编程', '代码', '调用', '层级', '分析'],
  code_hover_info: ['编程', '代码', '类型', '文档', '分析'],
};

// ==============================
// 工具安全分级
// ==============================

export const extToolSafetyLevels = {
  code_goto_definition: '安全',
  code_find_references: '安全',
  code_document_symbols: '安全',
  code_find_implementations: '安全',
  code_call_hierarchy: '安全',
  code_hover_info: '安全',
};

// ==============================
// 默认导出（兼容直接 import）
// ==============================
export default {
  extTools,
  handleExtTool,
  extToolCategories,
  extToolAbilityMap,
  extToolSafetyLevels,
};
