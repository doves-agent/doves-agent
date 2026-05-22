/**
 * Git 解析工具
 * 从 代码工具.js 提取
 */

/**
 * 解析 git status 输出为结构化数据
 */
export function parseGitStatus(output) {
  const lines = output.trim().split('\n').filter(l => l.trim());
  let branch = '';

  if (lines[0]) {
    const mPorcelain = lines[0].match(/^##\s+([^\.\s]+)/);
    if (mPorcelain) {
      branch = mPorcelain[1];
    } else {
      const mNormal = lines[0].match(/On branch (.+)/);
      if (mNormal) {
        branch = mNormal[1];
      }
    }
  }
  const files = [];

  for (const line of lines) {
    const match = line.match(/^[\s]*(M|A|D|R|\?\?|AM|MM)\s+(.+)$/);
    if (match) {
      const statusMap = {
        'M': 'modified', 'A': 'added', 'D': 'deleted',
        'R': 'renamed', '??': 'untracked', 'AM': 'added_modified', 'MM': 'modified_staged_and_unstaged'
      };
      files.push({
        status: statusMap[match[1]] || match[1],
        file: match[2].trim()
      });
    }
  }

  return { branch, files, raw: output.trim() };
}

/**
 * 解析 git log 输出为结构化数据
 */
export function parseGitLog(output) {
  const commits = [];
  const lines = output.trim().split('\n');

  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length >= 4) {
      commits.push({
        hash: parts[0].trim(),
        author: parts[1].trim(),
        date: parts[2].trim(),
        message: parts.slice(3).join('|').trim()
      });
    }
  }

  return commits;
}

/**
 * 自动分类变更类型
 */
export function classifyChange(filePath, commitMessage) {
  const msg = (commitMessage || '').toLowerCase();
  const fp = (filePath || '').toLowerCase();

  if (fp.match(/\.(md|txt|doc|rst)$/) || fp.includes('白鸽文档/') || fp.includes('docs/') || fp.includes('doc/'))
    return 'docs';
  if (fp.includes('test') || fp.includes('spec') || fp.match(/\.(test|spec)\./))
    return 'test';
  if (fp.match(/\.(json|yml|yaml|toml|ini|env|config)$/) || fp.includes('config'))
    return 'config';
  if (fp.includes('.github/') || fp.includes('ci/') || fp.includes('dockerfile'))
    return 'ci';
  if (msg.match(/^fix|bug|修复|修复了|bugfix/)) return 'bugfix';
  if (msg.match(/^feat|feature|新增|添加|新功能/)) return 'feature';
  if (msg.match(/^refactor|重构|优化|改进/)) return 'refactor';
  if (msg.match(/^style|格式|样式/)) return 'style';
  if (msg.match(/^perf|性能/)) return 'performance';
  return 'code';
}

/**
 * 解析 git blame --porcelain 输出
 */
export function parseGitBlame(output) {
  const lines = output.split('\n');
  const result = [];
  let current = null;
  let lineNumber = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (m) {
      current = {
        hash: m[1],
        line: parseInt(m[2], 10)
      };
      lineNumber = current.line;
    } else if (current && line.startsWith('author ')) {
      current.author = line.slice(7);
    } else if (current && line.startsWith('author-time ')) {
      const ts = parseInt(line.slice(12), 10);
      current.date = new Date(ts * 1000).toISOString().split('T')[0];
    } else if (current && line.startsWith('summary ')) {
      current.summary = line.slice(8);
    } else if (current && line.startsWith('\t')) {
      current.content = line.slice(1);
      result.push({
        line: current.line,
        hash: current.hash.substring(0, 7),
        fullHash: current.hash,
        author: current.author,
        date: current.date,
        content: current.content,
        summary: current.summary
      });
      current = null;
    }
  }

  return result;
}

/**
 * 解析 numstat 输出
 * 返回 { path, insertions, deletions, status? }
 */
export function parseNumstat(output) {
  const files = [];
  const lines = output.trim().split('\n');
  for (const line of lines) {
    const m = line.match(/^(\d+)\t(\d+)\t(.+)$/);
    if (m) {
      files.push({
        path: m[3].trim(),
        insertions: parseInt(m[1], 10),
        deletions: parseInt(m[2], 10)
      });
    }
  }
  return files;
}
