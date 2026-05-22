/**
 * Git PR平台工具
 * GitHub/GitLab/Gitee API 请求封装 + PR创建/列表/审查处理
 */

import fs from 'fs/promises';

const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

/**
 * GitHub API 请求
 */
export async function githubRequest(method, path, token, body = null) {
  const fetch = (await import('node-fetch')).default;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `token ${token}`
  };
  if (body) headers['Content-Type'] = 'application/json';

  const resp = await fetch(`https://api.github.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`GitHub API 错误: ${data.message || resp.statusText}`);
  }
  return data;
}

/**
 * GitLab API 请求
 */
export async function gitlabRequest(method, path, token, body = null, gitlabUrl = 'https://gitlab.com') {
  const fetch = (await import('node-fetch')).default;
  const headers = { 'Private-Token': token };
  if (body) headers['Content-Type'] = 'application/json';

  const resp = await fetch(`${gitlabUrl}/api/v4${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`GitLab API 错误: ${data.message || resp.statusText}`);
  }
  return data;
}

/**
 * PR处理函数（供 handleExtTool 中 switch 引用）
 */
export async function prHandlers(name, args) {
  switch (name) {

    // ===== git_pr_create =====
    case 'git_pr_create': {
      const { title, body = '', head, base = 'main', platform, repo, token, cwd } = args;
      try {
        let result;

        if (platform === 'github') {
          if (!token) return text({ error: 'GitHub PR创建需要token参数' });
          result = githubRequest('POST', `/repos/${repo}/pulls`, token, {
            title, body, head, base
          });
          return result.then(data => text({
            action: 'pr_create', platform, repo,
            prNumber: data.number, url: data.html_url, state: data.state,
            success: true
          }));
        }

        if (platform === 'gitlab') {
          if (!token) return text({ error: 'GitLab PR创建需要token参数' });
          const encodedPath = encodeURIComponent(repo);
          result = gitlabRequest('POST', `/projects/${encodedPath}/merge_requests`, token, {
            title, description: body, source_branch: head, target_branch: base
          });
          return result.then(data => text({
            action: 'pr_create', platform, repo,
            prNumber: data.iid, url: data.web_url, state: data.state,
            success: true
          }));
        }

        if (platform === 'gitee') {
          if (!token) return text({ error: 'Gitee PR创建需要token参数' });
          const fetch = (await import('node-fetch')).default;
          const resp = await fetch(`https://gitee.com/api/v5/repos/${repo}/pulls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, head, base, access_token: token })
          });
          result = await resp.json();
          if (!resp.ok) throw new Error(result.message || 'Gitee API错误');
          return text({
            action: 'pr_create', platform, repo,
            prNumber: result.number, url: result.html_url, state: result.state,
            success: true
          });
        }

        return text({ error: `不支持的平台: ${platform}` });
      } catch (e) {
        return text({ action: 'pr_create', error: e.message, platform, repo, success: false });
      }
    }

    // ===== git_pr_list =====
    case 'git_pr_list': {
      const { platform, repo, state = 'open', token, limit = 20 } = args;
      try {
        let prs;

        if (platform === 'github') {
          if (!token) return text({ error: 'GitHub PR列表需要token参数' });
          const data = await githubRequest('GET', `/repos/${repo}/pulls?state=${state}&per_page=${limit}`, token);
          prs = data.map(pr => ({
            number: pr.number, title: pr.title, state: pr.state,
            user: pr.user?.login, url: pr.html_url,
            head: pr.head?.ref, base: pr.base?.ref, created_at: pr.created_at
          }));
        } else if (platform === 'gitlab') {
          if (!token) return text({ error: 'GitLab PR列表需要token参数' });
          const encodedPath = encodeURIComponent(repo);
          const data = await gitlabRequest('GET', `/projects/${encodedPath}/merge_requests?state=${state}&per_page=${limit}`, token);
          prs = data.map(mr => ({
            number: mr.iid, title: mr.title, state: mr.state,
            user: mr.author?.username, url: mr.web_url,
            head: mr.source_branch, base: mr.target_branch, created_at: mr.created_at
          }));
        } else {
          return text({ error: `不支持的平台: ${platform}` });
        }

        return text({ action: 'pr_list', platform, repo, state, total: prs.length, prs });
      } catch (e) {
        return text({ action: 'pr_list', error: e.message, platform, repo });
      }
    }

    // ===== git_pr_review =====
    case 'git_pr_review': {
      const { platform, repo, prNumber, token } = args;
      try {
        let reviewData;

        if (platform === 'github') {
          if (!token) return text({ error: 'GitHub PR审查需要token参数' });
          const pr = await githubRequest('GET', `/repos/${repo}/pulls/${prNumber}`, token);
          const files = await githubRequest('GET', `/repos/${repo}/pulls/${prNumber}/files`, token);
          reviewData = {
            prNumber, title: pr.title, body: pr.body,
            state: pr.state, user: pr.user?.login,
            head: pr.head?.ref, base: pr.base?.ref,
            additions: pr.additions, deletions: pr.deletions,
            changed_files: pr.changed_files,
            files: files.map(f => ({
              filename: f.filename, status: f.status,
              additions: f.additions, deletions: f.deletions, patch: f.patch
            }))
          };
        } else if (platform === 'gitlab') {
          if (!token) return text({ error: 'GitLab PR审查需要token参数' });
          const encodedPath = encodeURIComponent(repo);
          const mr = await gitlabRequest('GET', `/projects/${encodedPath}/merge_requests/${prNumber}`, token);
          const changes = await gitlabRequest('GET', `/projects/${encodedPath}/merge_requests/${prNumber}/changes`, token);
          reviewData = {
            prNumber, title: mr.title, body: mr.description,
            state: mr.state, user: mr.author?.username,
            head: mr.source_branch, base: mr.target_branch,
            files: (changes.changes || []).map(c => ({
              filename: c.new_path, status: c.new_file ? 'added' : c.deleted_file ? 'deleted' : 'modified',
              diff: c.diff
            }))
          };
        } else {
          return text({ error: `不支持的平台: ${platform}` });
        }

        return text({
          action: 'pr_review', platform, repo, prNumber,
          reviewData,
          hint: '请基于以上PR变更信息进行代码审查，从安全/性能/规范/可维护性等维度分析'
        });
      } catch (e) {
        return text({ action: 'pr_review', error: e.message, platform, repo, prNumber });
      }
    }

    default:
      return null; // 不认识的工具返回 null，让其他扩展处理
  }
}
