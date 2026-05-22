/**
 * LSP 结果解析器
 * 职责：URI 转换、Location/Symbol/Hover/CallHierarchy 解析
 */

import { join } from 'path';

/**
 * 文件路径转 URI
 */
function toUri(filePath) {
  const absPath = filePath.includes(':') ? filePath : join(process.cwd(), filePath);
  return `file:///${absPath.replace(/\\/g, '/').replace(/^\//, '')}`;
}

/**
 * URI 转文件路径
 */
function fromUri(uri) {
  if (!uri) return null;
  const path = uri.replace(/^file:\/\//, '').replace(/\//g, '\\');
  return decodeURIComponent(path);
}

/**
 * 解析 Location / LocationLink 结果
 */
function parseLocations(result) {
  if (!result) return [];

  // 单个位置
  if (result.uri) {
    return [locationToResult(result)];
  }

  // 数组
  if (Array.isArray(result)) {
    return result.map(item => locationToResult(item));
  }

  return [];
}

/**
 * 将 Location 或 LocationLink 转为统一格式
 */
function locationToResult(loc) {
  const uri = loc.uri || (loc.targetUri || null);
  const range = loc.range || (loc.targetRange || null);

  return {
    uri: uri,
    filePath: fromUri(uri) || uri,
    range: range ? {
      start: { line: range.start.line + 1, character: range.start.character + 1 },
      end: { line: range.end.line + 1, character: range.end.character + 1 },
    } : null,
    originSelectionRange: loc.originSelectionRange ? {
      start: { line: loc.originSelectionRange.start.line + 1, character: loc.originSelectionRange.start.character + 1 },
      end: { line: loc.originSelectionRange.end.line + 1, character: loc.originSelectionRange.end.character + 1 },
    } : null,
  };
}

/**
 * 解析 SymbolInformation[] / DocumentSymbol[]
 */
function parseSymbols(result) {
  if (!result) return [];

  if (Array.isArray(result)) {
    return result.flatMap(item => symbolToResult(item));
  }

  return [];
}

function symbolToResult(symbol, parentName = '') {
  // DocumentSymbol 格式（层级）
  if (symbol.name && (symbol.kind || symbol.children)) {
    const fullName = parentName ? `${parentName}.${symbol.name}` : symbol.name;
    const entry = {
      name: symbol.name,
      fullName,
      kind: symbol.kind,
      detail: symbol.detail || '',
      tags: symbol.tags || [],
      range: symbol.range ? {
        start: { line: symbol.range.start.line + 1, character: symbol.range.start.character + 1 },
        end: { line: symbol.range.end.line + 1, character: symbol.range.end.character + 1 },
      } : null,
      selectionRange: symbol.selectionRange ? {
        start: { line: symbol.selectionRange.start.line + 1, character: symbol.selectionRange.start.character + 1 },
        end: { line: symbol.selectionRange.end.line + 1, character: symbol.selectionRange.end.character + 1 },
      } : null,
      children: [],
      containerName: parentName,
    };

    // 递归处理子符号
    if (symbol.children && symbol.children.length > 0) {
      for (const child of symbol.children) {
        entry.children.push(symbolToResult(child, fullName));
      }
    }
    return entry;
  }

  // SymbolInformation 格式（扁平 + containerName）
  if (symbol.name) {
    return {
      name: symbol.name,
      fullName: symbol.containerName ? `${symbol.containerName}.${symbol.name}` : symbol.name,
      kind: symbol.kind,
      detail: symbol.detail || '',
      tags: symbol.tags || [],
      location: symbol.location ? {
        uri: symbol.location.uri,
        filePath: fromUri(symbol.location.uri) || symbol.location.uri,
        range: {
          start: { line: symbol.location.range.start.line + 1, character: symbol.location.range.start.character + 1 },
          end: { line: symbol.location.range.end.line + 1, character: symbol.location.range.end.character + 1 },
        },
      } : null,
      containerName: symbol.containerName || parentName,
    };
  }

  return null;
}

/**
 * 解析 Hover 结果
 */
function parseHover(result) {
  if (!result) return null;

  const contents = result.contents;
  const range = result.range;

  let markdown = '';
  if (typeof contents === 'string') {
    markdown = contents;
  } else if (Array.isArray(contents)) {
    markdown = contents.map(c => typeof c === 'string' ? c : (c.value || '')).join('\n');
  } else if (contents && contents.kind) {
    // MarkupContent
    markdown = contents.value;
  }

  return {
    contents: markdown,
    range: range ? {
      start: { line: range.start.line + 1, character: range.start.character + 1 },
      end: { line: range.end.line + 1, character: range.end.character + 1 },
    } : null,
  };
}

/**
 * 解析 CallHierarchyItem[]
 */
function parseCallHierarchyItems(result) {
  if (!result) return [];
  if (!Array.isArray(result)) result = [result];
  return result.map(item => ({
    name: item.name,
    kind: item.kind,
    detail: item.detail || '',
    uri: item.uri,
    filePath: fromUri(item.uri) || item.uri,
    range: item.range ? {
      start: { line: item.range.start.line + 1, character: item.range.start.character + 1 },
      end: { line: item.range.end.line + 1, character: item.range.end.character + 1 },
    } : null,
    selectionRange: item.selectionRange ? {
      start: { line: item.selectionRange.start.line + 1, character: item.selectionRange.start.character + 1 },
      end: { line: item.selectionRange.end.line + 1, character: item.selectionRange.end.character + 1 },
    } : null,
    _raw: item, // 供后续调用层级使用
  }));
}

/**
 * 解析 CallHierarchyIncomingCall[] / CallHierarchyOutgoingCall[]
 */
function parseCallHierarchyCalls(result) {
  if (!result) return [];
  return result.map(call => ({
    from: call.from ? {
      name: call.from.name,
      kind: call.from.kind,
      detail: call.from.detail || '',
      uri: call.from.uri,
      filePath: fromUri(call.from.uri) || call.from.uri,
      range: call.from.range ? {
        start: { line: call.from.range.start.line + 1, character: call.from.range.start.character + 1 },
        end: { line: call.from.range.end.line + 1, character: call.from.range.end.character + 1 },
      } : null,
    } : null,
    fromRanges: (call.fromRanges || []).map(r => ({
      start: { line: r.start.line + 1, character: r.start.character + 1 },
      end: { line: r.end.line + 1, character: r.end.character + 1 },
    })),
  }));
}

export {
  toUri,
  fromUri,
  parseLocations,
  parseSymbols,
  parseHover,
  parseCallHierarchyItems,
  parseCallHierarchyCalls,
};
