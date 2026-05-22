/**
 * PR管理技能
 * 
 * 能力：
 * - 支持 GitHub / GitLab / Gitee
 * - 基于commit历史和diff自动生成PR描述
 * - PR状态跟踪
 * - PR审查提交
 * - PR合并操作
 * - PR模板生成
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('pr_manager', { 前缀: '[pr_manager]', 级别: 'debug', 显示调用位置: true });

/**
 * 执行git命令
 */
async function runGit(args, cwd = process.cwd()) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024
    });
    return { stdout: stdout || '', stderr: stderr || '' };
  } catch (error) {
    throw new Error(`git ${args.join(' ')} 失败: ${error.message}`);
  }
}

/**
 * 自动生成PR描述
 * 基于当前分支与目标分支的commit历史和diff统计
 */
async function 生成PR描述(baseBranch = 'main', cwd) {
  // 获取当前分支名
  const { stdout: branchOutput } = await runGit(['branch', '--show-current'], cwd);
  const currentBranch = branchOutput.trim();

  if (!currentBranch) {
    return { title: 'Merge changes', body: '' };
  }

  // 获取commit历史
  const { stdout: logOutput } = await runGit([
    'log', `${baseBranch}..HEAD`, '--pretty=format:%s'
  ], cwd);
  const commits = logOutput.trim().split('\n').filter(l => l.trim());

  // 获取diff统计
  const { stdout: diffOutput } = await runGit([
    'diff', '--stat', `${baseBranch}..HEAD`
  ], cwd);

  // 获取文件变更列表
  const { stdout: filesOutput } = await runGit([
    'diff', '--name-status', `${baseBranch}..HEAD`
  ], cwd);
  const fileChanges = filesOutput.trim().split('\n')
    .filter(l => l.trim())
    .map(line => {
      const [status, ...pathParts] = line.split('\t');
      return { status, path: pathParts.join('\t') };
    });

  // 自动生成标题：取第一个commit的消息作为标题
  const title = commits[0] || `Merge ${currentBranch} into ${baseBranch}`;

  // 生成描述
  const bodyParts = [];
  bodyParts.push('## 变更摘要\n');
  bodyParts.push(`分支: \`${currentBranch}\` → \`${baseBranch}\`\n`);
  bodyParts.push(`提交数: ${commits.length}\n`);

  if (commits.length > 0) {
    bodyParts.push('\n## 提交列表\n');
    for (const commit of commits) {
      bodyParts.push(`- ${commit}\n`);
    }
  }

  if (fileChanges.length > 0) {
    bodyParts.push('\n## 文件变更\n');
    const statusMap = { 'A': '新增', 'M': '修改', 'D': '删除', 'R': '重命名' };
    for (const fc of fileChanges) {
      bodyParts.push(`- [${statusMap[fc.status] || fc.status}] ${fc.path}\n`);
    }
  }

  if (diffOutput.trim()) {
    bodyParts.push('\n## Diff统计\n```\n');
    bodyParts.push(diffOutput.trim());
    bodyParts.push('\n```\n');
  }

  return {
    title,
    body: bodyParts.join(''),
    branch: currentBranch,
    baseBranch,
    commitCount: commits.length,
    fileCount: fileChanges.length
  };
}

/**
 * 执行PR管理
 */
async function execute(args, context) {
  const { action = 'generate_description', cwd = process.cwd() } = args;

  logger.info(`执行: ${action}, cwd: ${cwd}`);

  try {
    switch (action) {

      // 自动生成PR描述
      case 'generate_description': {
        const { base = 'main' } = args;
        const 描述 = await 生成PR描述(base, cwd);
        return {
          成功: true,
          数据: 描述
        };
      }

      // 获取当前分支信息
      case 'branch_info': {
        const { stdout: branchOutput } = await runGit(['branch', '--show-current'], cwd);
        const { stdout: remoteOutput } = await runGit(['remote', '-v'], cwd);
        const { stdout: statusOutput } = await runGit(['status', '--porcelain', '-b'], cwd);

        const remotes = remoteOutput.trim().split('\n')
          .filter(l => l.includes('(fetch)'))
          .map(l => {
            const match = l.match(/^(\S+)\s+(\S+)\s+\(fetch\)/);
            return match ? { name: match[1], url: match[2] } : null;
          })
          .filter(Boolean);

        // 尝试推断平台
        let platform = null;
        for (const remote of remotes) {
          if (remote.url.includes('github.com')) { platform = 'github'; break; }
          if (remote.url.includes('gitlab')) { platform = 'gitlab'; break; }
          if (remote.url.includes('gitee.com')) { platform = 'gitee'; break; }
        }

        // 尝试提取repo路径
        let repo = null;
        if (platform) {
          const remoteUrl = remotes[0]?.url || '';
          const sshMatch = remoteUrl.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
          const httpsMatch = remoteUrl.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
          repo = (sshMatch || httpsMatch)?.[1] || null;
        }

        return {
          成功: true,
          数据: {
            currentBranch: branchOutput.trim(),
            remotes,
            platform,
            repo,
            status: statusOutput.trim()
          }
        };
      }

      // 提交PR审查评论
      case 'review_submit': {
        const { platform, repo, prNumber, body, event = 'COMMENT', token: reviewToken } = args;
        if (!platform || !repo || !prNumber) {
          return { 成功: false, 错误: '缺少必填参数: platform, repo, prNumber' };
        }
        if (!reviewToken) {
          return { 成功: false, 错误: '需要token参数' };
        }

        try {
          const fetch = (await import('node-fetch')).default;

          if (platform === 'github') {
            const resp = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`, {
              method: 'POST',
              headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${reviewToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ body, event })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.message || 'GitHub API错误');
            return { 成功: true, 数据: { reviewId: data.id, state: data.state, url: data.html_url } };
          }

          if (platform === 'gitlab') {
            const encodedPath = encodeURIComponent(repo);
            const resp = await fetch(`https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${prNumber}/notes`, {
              method: 'POST',
              headers: {
                'Private-Token': reviewToken,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ body })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.message || 'GitLab API错误');
            return { 成功: true, 数据: { noteId: data.id, url: `https://gitlab.com/${repo}/-/merge_requests/${prNumber}#note_${data.id}` } };
          }

          if (platform === 'gitee') {
            const resp = await fetch(`https://gitee.com/api/v5/repos/${repo}/pulls/${prNumber}/comments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ body, access_token: reviewToken })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.message || 'Gitee API错误');
            return { 成功: true, 数据: { commentId: data.id } };
          }

          return { 成功: false, 错误: `不支持的平台: ${platform}` };
        } catch (e) {
          return { 成功: false, 错误: e.message };
        }
      }

      // 合并PR
      case 'merge_pr': {
        const { platform, repo, prNumber, mergeMethod = 'merge', commitTitle, commitMessage, token: mergeToken } = args;
        if (!platform || !repo || !prNumber) {
          return { 成功: false, 错误: '缺少必填参数: platform, repo, prNumber' };
        }
        if (!mergeToken) {
          return { 成功: false, 错误: '需要token参数' };
        }

        try {
          const fetch = (await import('node-fetch')).default;

          if (platform === 'github') {
            const ghMethod = mergeMethod === 'squash' ? 'squash' : mergeMethod === 'rebase' ? 'rebase' : 'merge';
            const requestBody = { merge_method: ghMethod };
            if (commitTitle) requestBody.commit_title = commitTitle;
            if (commitMessage) requestBody.commit_message = commitMessage;

            const resp = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/merge`, {
              method: 'PUT',
              headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${mergeToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(requestBody)
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.message || 'GitHub合并失败');
            return { 成功: true, 数据: { message: data.message || 'PR已合并', merged: data.merged !== false } };
          }

          if (platform === 'gitlab') {
            const encodedPath = encodeURIComponent(repo);
            const requestBody = {};
            if (commitTitle) requestBody.merge_commit_message = commitTitle;
            if (mergeMethod === 'squash') requestBody.squash = true;

            const resp = await fetch(`https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${prNumber}/merge`, {
              method: 'PUT',
              headers: {
                'Private-Token': mergeToken,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(requestBody)
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.message || 'GitLab合并失败');
            return { 成功: true, 数据: { state: data.state, url: data.web_url } };
          }

          return { 成功: false, 错误: `不支持的平台: ${platform}` };
        } catch (e) {
          return { 成功: false, 错误: e.message };
        }
      }

      // PR状态跟踪
      case 'status_track': {
        const { platform, repo, prNumber, token: trackToken } = args;
        if (!platform || !repo || !prNumber) {
          return { 成功: false, 错误: '缺少必填参数: platform, repo, prNumber' };
        }
        if (!trackToken) {
          return { 成功: false, 错误: '需要token参数' };
        }

        try {
          const fetch = (await import('node-fetch')).default;

          if (platform === 'github') {
            // PR基本信息
            const prResp = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
              headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${trackToken}` }
            });
            const prData = await prResp.json();
            if (!prResp.ok) throw new Error(prData.message || '获取PR信息失败');

            // CI检查状态
            const checksResp = await fetch(`https://api.github.com/repos/${repo}/commits/${prData.head.sha}/check-runs`, {
              headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${trackToken}` }
            });
            const checksData = await checksResp.json();

            // 审查状态
            const reviewsResp = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`, {
              headers: { 'Accept': 'application/vnd.github.v3+json', 'Authorization': `token ${trackToken}` }
            });
            const reviewsData = await reviewsResp.json();

            const approved = reviewsData.some(r => r.state === 'APPROVED');
            const changesRequested = reviewsData.some(r => r.state === 'CHANGES_REQUESTED');
            const checksStatus = checksData.check_runs?.length > 0
              ? checksData.check_runs.every(c => c.status === 'completed' && c.conclusion === 'success') ? 'passed' : 'pending'
              : 'unknown';

            return {
              成功: true,
              数据: {
                prNumber, title: prData.title, state: prData.state,
                mergeable: prData.mergeable,
                可合并: prData.mergeable === true,
                审查状态: approved ? '已批准' : changesRequested ? '需修改' : '待审查',
                CI状态: checksStatus,
                CI详情: (checksData.check_runs || []).map(c => ({ name: c.name, status: c.status, conclusion: c.conclusion })),
                审查详情: reviewsData.map(r => ({ user: r.user?.login, state: r.state, body: r.body })),
                合并建议: prData.mergeable && approved && checksStatus === 'passed' ? '可以合并' : '尚不可合并'
              }
            };
          }

          if (platform === 'gitlab') {
            const encodedPath = encodeURIComponent(repo);
            const mrResp = await fetch(`https://gitlab.com/api/v4/projects/${encodedPath}/merge_requests/${prNumber}`, {
              headers: { 'Private-Token': trackToken }
            });
            const mrData = await mrResp.json();
            if (!mrResp.ok) throw new Error(mrData.message || '获取MR信息失败');

            // Pipeline状态
            let pipelineStatus = 'unknown';
            if (mrData.pipeline) {
              pipelineStatus = mrData.pipeline.status || 'unknown';
            }

            return {
              成功: true,
              数据: {
                prNumber, title: mrData.title, state: mrData.state,
                可合并: mrData.merge_status === 'can_be_merged',
                CI状态: pipelineStatus,
                合并建议: mrData.merge_status === 'can_be_merged' && mrData.state === 'opened' ? '可以合并' : '尚不可合并'
              }
            };
          }

          return { 成功: false, 错误: `不支持的平台: ${platform}` };
        } catch (e) {
          return { 成功: false, 错误: e.message };
        }
      }

      // 生成PR模板
      case 'template_generate': {
        const { templateType = 'default', customSections } = args;

        const templates = {
          default: `## 变更描述
<!-- 描述本次PR的主要变更内容 -->

## 变更类型
- [ ] 新功能 (feature)
- [ ] 缺陷修复 (bugfix)
- [ ] 重构 (refactor)
- [ ] 文档 (docs)
- [ ] 测试 (test)
- [ ] 配置 (config)

## 测试情况
<!-- 描述测试方法和结果 -->

## 检查清单
- [ ] 代码已自测
- [ ] 添加了必要的注释
- [ ] 更新了相关文档
- [ ] 没有引入新的警告`,

          bugfix: `## Bug描述
<!-- 描述修复的Bug -->

## 根因分析
<!-- Bug产生的根本原因 -->

## 修复方案
<!-- 如何修复的 -->

## 测试验证
<!-- 如何验证修复有效 -->

## 影响范围
<!-- 修复可能影响的范围 -->

## 回归风险
- [ ] 低风险（局部修改，逻辑独立）
- [ ] 中风险（影响多个模块）
- [ ] 高风险（核心逻辑变更）`,

          feature: `## 功能描述
<!-- 描述新增功能 -->

## 设计方案
<!-- 实现方案概述 -->

## 使用说明
<!-- 如何使用新功能 -->

## API变更
<!-- 如有API变更，描述变更内容 -->

## 数据库变更
<!-- 如有数据库变更，描述变更内容 -->

## 测试覆盖
- [ ] 单元测试
- [ ] 集成测试
- [ ] 手动测试

## 文档更新
- [ ] API文档
- [ ] 使用手册
- [ ] 变更日志`,

          breaking: `## ⚠️ 破坏性变更

### 变更描述
<!-- 描述破坏性变更的内容 -->

### 影响范围
<!-- 列出受影响的模块/接口/配置 -->

### 迁移指南
<!-- 如何从旧版本迁移 -->

### 兼容性处理
<!-- 是否提供了兼容层 -->

### 回退方案
<!-- 如何回退此变更 -->
`
        };

        let template = templates[templateType] || templates.default;

        // 追加自定义段
        if (customSections && Array.isArray(customSections)) {
          for (const section of customSections) {
            template += `\n## ${section}\n<!-- ${section}的内容 -->\n`;
          }
        }

        return {
          成功: true,
          数据: {
            templateType,
            template,
            可用模板: Object.keys(templates)
          }
        };
      }

      default:
        return { 成功: false, 错误: `未知操作: ${action}` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return { 成功: false, 错误: error.message };
  }
}

export default {
  name: 'pr_manager',
  description: 'PR管理技能 — 自动生成PR描述、分支信息、平台推断',
  abilities: ['Git', 'PR管理', '版本控制'],
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['generate_description', 'branch_info', 'review_submit', 'merge_pr', 'status_track', 'template_generate'],
        description: '操作类型：generate_description(自动生成PR描述) / branch_info(获取分支和远程信息) / review_submit(提交审查评论) / merge_pr(合并PR) / status_track(PR状态跟踪) / template_generate(生成PR模板)'
      },
      base: { type: 'string', description: '基准分支名（generate_description使用，默认main）' },
      platform: { type: 'string', enum: ['github', 'gitlab', 'gitee'], description: '平台类型（review_submit/merge_pr/status_track使用）' },
      repo: { type: 'string', description: '仓库名（如 owner/repo，review_submit/merge_pr/status_track使用）' },
      prNumber: { type: 'number', description: 'PR编号（review_submit/merge_pr/status_track使用）' },
      body: { type: 'string', description: '审查评论内容（review_submit使用）' },
      event: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'], description: '审查事件类型（review_submit使用，默认COMMENT）' },
      mergeMethod: { type: 'string', enum: ['merge', 'squash', 'rebase'], description: '合并方式（merge_pr使用，默认merge）' },
      commitTitle: { type: 'string', description: '合并提交标题（merge_pr使用，可选）' },
      commitMessage: { type: 'string', description: '合并提交消息（merge_pr使用，可选）' },
      token: { type: 'string', description: '平台访问令牌（review_submit/merge_pr/status_track使用）' },
      templateType: { type: 'string', enum: ['default', 'bugfix', 'feature', 'breaking'], description: 'PR模板类型（template_generate使用，默认default）' },
      customSections: { type: 'array', items: { type: 'string' }, description: '自定义模板段落数组（template_generate使用，可选）' },
      cwd: { type: 'string', description: '工作目录' }
    },
    required: ['action']
  },
  execute
};
