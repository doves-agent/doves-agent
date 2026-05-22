/**
 * @file 精简工具执行-网络与搜索
 * @description KISS 精简工具 - HTTP 请求、网页搜索/抓取、代码语义搜索
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { 创建日志器 } from '@dove/common/日志管理器.js';
import { safePath } from './精简工具执行-文件操作.js';

const logger = 创建日志器('精简工具-网络与搜索', { 前缀: '[精简工具-网络与搜索]', 级别: 'debug' });

// ==================== HTTP 请求 ====================

export async function http获取(args) {
  const headers = { 'User-Agent': 'Dove/2.0' };
  if (args.headers) Object.assign(headers, args.headers);
  const resp = await fetch(args.url, { method: 'GET', headers, signal: AbortSignal.timeout(30000) });
  const text = await resp.text();
  return `HTTP ${resp.status}\n${text.substring(0, 5000)}`;
}

export async function http发送(args) {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Dove/2.0' };
  if (args.headers) Object.assign(headers, args.headers);
  const resp = await fetch(args.url, {
    method: 'POST',
    headers,
    body: args.body || undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await resp.text();
  return `HTTP ${resp.status}\n${text.substring(0, 5000)}`;
}

// ==================== Web 搜索 ====================

export async function 网页搜索(args) {
  const q = encodeURIComponent(args.query);
  const count = args.count || 5;
  try {
    const resp = await fetch(`https://cn.bing.com/search?q=${q}&count=${count}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
    const html = await resp.text();
    const results = [];
    // Bing 搜索结果: <li class="b_algo"><h2><a href="...">标题</a></h2><p>摘要</p></li>
    const blockRe = /<li[^>]*class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
    let block;
    while ((block = blockRe.exec(html)) !== null && results.length < count) {
      const linkMatch = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(block[1]);
      const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block[1]);
      if (!linkMatch) continue;
      const url = linkMatch[1];
      const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';
      results.push(`${results.length + 1}. ${title}\n   URL: ${url}\n   ${snippet}`);
    }
    return results.join('\n\n') || '未找到搜索结果';
  } catch (e) {
    return `搜索失败: ${e.message}`;
  }
}

export async function 网页抓取(args) {
  try {
    const resp = await fetch(args.url, {
      headers: { 'User-Agent': 'Dove/2.0' },
      signal: AbortSignal.timeout(20000),
    });
    const html = await resp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    const maxChars = args.max_chars || 5000;
    return text.substring(0, maxChars);
  } catch (e) {
    return `抓取失败: ${e.message}`;
  }
}

// ==================== 代码语义搜索 ====================

export async function 语义搜代码(args) {
  const dir = args.directory ? safePath(args.directory) : process.cwd();
  const keywords = args.query.split(/\s+/).filter(k => k.length > 1);
  if (keywords.length === 0) return '请提供更具体的搜索描述';

  const results = [];
  const codeExts = ['.js', '.ts', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.jsx', '.tsx', '.vue'];

  function walk(searchDir, depth) {
    if (depth > 15) return;
    if (!existsSync(searchDir)) return;
    try {
      const entries = readdirSync(searchDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
        const full = join(searchDir, e.name);
        if (e.isDirectory()) { walk(full, depth + 1); continue; }
        const ext = e.name.substring(e.name.lastIndexOf('.'));
        if (!codeExts.includes(ext)) continue;
        try {
          const content = readFileSync(full, 'utf-8');
          for (const kw of keywords.slice(0, 3)) {
            if (content.toLowerCase().includes(kw.toLowerCase())) {
              const rel = relative(dir, full);
              results.push(`  ${rel}（匹配: "${kw}"）`);
              break;
            }
          }
        } catch (_) { logger.debug(`语义搜代码跳过不可读文件: ${full}`); }
        if (results.length >= 50) return;
      }
    } catch (_) { logger.debug(`语义搜代码目录遍历跳过 (权限不足): ${searchDir}`); }
  }

  walk(dir, 0);
  return results.length > 0
    ? `在 ${dir} 中找到 ${results.length} 个匹配文件:\n${results.join('\n')}`
    : `在 ${dir} 中未找到与 "${args.query}" 相关的代码`;
}
