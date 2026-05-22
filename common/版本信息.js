/**
 * @file 版本信息
 * @description 当前版本号和组件名，由构建脚本通过 esbuild define 注入
 *
 * 构建时 esbuild 会将以下标识符替换为字面量：
 *   __VERSION__    → "0.0.31" 等
 *   __COMPONENT__  → "doves" | "cli" | "server"
 *
 * 开发模式下（未经 esbuild），通过 typeof 检测回退到默认值
 */

// eslint-disable-next-line no-undef
export const 当前版本 = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

// eslint-disable-next-line no-undef
const _组件名 = typeof __COMPONENT__ !== 'undefined' ? __COMPONENT__ : _推断组件名();

/**
 * 获取当前组件名
 * @returns {'doves'|'cli'|'server'|'unknown'}
 */
export function 获取组件名() {
  return _组件名;
}

/**
 * 从可执行文件名或脚本路径推断组件名（开发模式回退）
 */
function _推断组件名() {
  // 编译二进制：从 execPath 文件名推断
  const execBasename = (process.execPath || '').split(/[/\\]/).pop().toLowerCase();
  if (execBasename === 'dove-server' || execBasename === 'dove-server.exe') return 'server';
  if (execBasename === 'doves' || execBasename === 'doves.exe') return 'doves';
  if (execBasename === 'dc' || execBasename === 'dc.exe') return 'cli';

  // 开发模式：从脚本路径推断
  const entryPath = process.argv[1] || '';
  if (entryPath.includes('doves')) return 'doves';
  if (entryPath.includes('cli')) return 'cli';
  if (entryPath.includes('server')) return 'server';

  return 'unknown';
}
