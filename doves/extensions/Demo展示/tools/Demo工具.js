/**
 * Demo展示工具 - 扩展包版本
 * 5个工具：demo_create / demo_update / demo_from_data / demo_template_list / demo_share
 * 
 * 核心设计：不是Docker部署，是LLM生成HTML页面+OSS托管
 */

import { randomBytes } from 'crypto';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('Demo工具', { 前缀: '[Demo工具]', 级别: 'debug', 显示调用位置: true });

// ==================== Demo模板库 ====================

const DEMO_TEMPLATES = {
  product_showcase: {
    id: 'product_showcase',
    name: '产品展示',
    description: 'Hero区 + 功能列表 + 截图 + 定价',
    sections: ['hero', 'features', 'screenshots', 'pricing', 'cta'],
    techStack: 'html',
    thumbnail: '📦',
  },
  data_dashboard: {
    id: 'data_dashboard',
    name: '数据看板',
    description: 'ECharts图表 + 筛选器 + 实时数据',
    sections: ['header', 'filters', 'charts', 'tables', 'summary'],
    techStack: 'html+echarts',
    thumbnail: '📊',
  },
  api_debug: {
    id: 'api_debug',
    name: 'API调试',
    description: '接口列表 + 参数表 + Try it out',
    sections: ['sidebar', 'endpoint_list', 'request_form', 'response_viewer'],
    techStack: 'html',
    thumbnail: '🔌',
  },
  form_demo: {
    id: 'form_demo',
    name: '表单Demo',
    description: '表单 + 校验 + 提交反馈',
    sections: ['form_fields', 'validation', 'submit_feedback', 'results'],
    techStack: 'html',
    thumbnail: '📝',
  },
  mobile_preview: {
    id: 'mobile_preview',
    name: '移动端预览',
    description: '手机壳包裹 + 交互区域',
    sections: ['phone_frame', 'app_content', 'navigation', 'interactions'],
    techStack: 'html',
    thumbnail: '📱',
  },
};

// ==================== 工具定义 ====================

export const extTools = [
  {
    name: 'demo_create',
    description: '生成Demo页面（HTML/CSS/JS）并托管到OSS，返回可访问URL。可选择模板或自定义。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Demo标题（必填）' },
        template: { type: 'string', enum: ['product_showcase', 'data_dashboard', 'api_debug', 'form_demo', 'mobile_preview', 'custom'], description: 'Demo模板（默认custom）' },
        description: { type: 'string', description: 'Demo描述' },
        html: { type: 'string', description: '完整HTML内容（自定义模板时必填）' },
        content: {
          type: 'object',
          description: '模板内容变量（按模板类型提供不同字段）',
          properties: {
            heroTitle: { type: 'string' },
            heroSubtitle: { type: 'string' },
            features: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' } } } },
            charts: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, title: { type: 'string' }, data: { type: 'object' } } } },
            endpoints: { type: 'array', items: { type: 'object', properties: { method: { type: 'string' }, path: { type: 'string' }, description: { type: 'string' } } } },
            fields: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, label: { type: 'string' }, required: { type: 'boolean' } } } },
          }
        },
        visibility: { type: 'string', enum: ['private', 'public'], description: '可见性（默认private）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' }
      },
      required: ['title']
    }
  },
  {
    name: 'demo_update',
    description: '更新已托管的Demo页面内容',
    inputSchema: {
      type: 'object',
      properties: {
        demoId: { type: 'string', description: 'Demo ID（必填）' },
        title: { type: 'string', description: '新标题' },
        html: { type: 'string', description: '新HTML内容' },
        content: { type: 'object', description: '新模板内容变量' },
        tags: { type: 'array', items: { type: 'string' }, description: '新标签' }
      },
      required: ['demoId']
    }
  },
  {
    name: 'demo_from_data',
    description: '从结构化数据生成图表/表格Demo页面，支持ECharts图表类型',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Demo标题（必填）' },
        data: { type: 'object', description: '数据（必填）' },
        chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'scatter', 'radar', 'table', 'mixed'], description: '图表类型（默认bar）' },
        options: { type: 'object', description: 'ECharts配置覆盖', properties: { theme: { type: 'string', enum: ['light', 'dark'] }, animation: { type: 'boolean' } } },
        visibility: { type: 'string', enum: ['private', 'public'], description: '可见性（默认private）' }
      },
      required: ['title', 'data']
    }
  },
  {
    name: 'demo_template_list',
    description: '列出可用的Demo模板',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '按分类过滤（可选）' }
      }
    }
  },
  {
    name: 'demo_share',
    description: '生成Demo分享链接和可选二维码',
    inputSchema: {
      type: 'object',
      properties: {
        demoId: { type: 'string', description: 'Demo ID（必填）' },
        expiresIn: { type: 'number', description: '分享链接过期时间秒数（0=永久）' },
        generateQR: { type: 'boolean', description: '是否生成二维码（默认false）' }
      },
      required: ['demoId']
    }
  }
];

// ==================== 工具分类/映射/安全分级 ====================

export const extToolCategories = {
  'Demo工具': ['demo_create', 'demo_update', 'demo_from_data', 'demo_template_list', 'demo_share'],
};

export const extToolAbilityMap = {
  demo_create: ['Demo展示', '页面生成'],
  demo_update: ['Demo展示'],
  demo_from_data: ['Demo展示', '页面生成'],
  demo_template_list: ['Demo展示', 'Demo模板'],
  demo_share: ['Demo展示'],
};

export const extToolSafetyLevels = {
  demo_create: '谨慎',
  demo_update: '谨慎',
  demo_from_data: '谨慎',
  demo_template_list: '安全',
  demo_share: '安全',
};

// ==================== 内存缓存 ====================

const _demo缓存 = new Map();

function 生成DemoID() {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString('hex');
  return `demo_${timestamp}_${random}`;
}

const text = (content) => ({
  content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }]
});

// ==================== HTML模板生成器 ====================

/**
 * 根据模板和内容变量生成HTML
 */
function 根据模板生成HTML(templateId, content = {}) {
  switch (templateId) {
    case 'product_showcase':
      return 生成产品展示HTML(content);
    case 'data_dashboard':
      return 生成数据看板HTML(content);
    case 'api_debug':
      return 生成API调试HTML(content);
    case 'form_demo':
      return 生成表单DemoHTML(content);
    case 'mobile_preview':
      return 生成移动端预览HTML(content);
    default:
      return null;
  }
}

function 生成产品展示HTML(c) {
  const features = (c.features || []).map(f =>
    `<div class="feature"><div class="feature-icon">${f.icon || '✨'}</div><h3>${f.title || ''}</h3><p>${f.description || ''}</p></div>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${c.heroTitle || '产品展示'}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333}
.hero{text-align:center;padding:80px 20px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff}
.hero h1{font-size:3em;margin-bottom:16px}.hero p{font-size:1.2em;opacity:.9}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:30px;padding:60px 40px;max-width:1200px;margin:0 auto}
.feature{text-align:center;padding:30px;border-radius:12px;background:#f8f9fa;transition:transform .2s}
.feature:hover{transform:translateY(-4px)}.feature-icon{font-size:2.5em;margin-bottom:16px}
.feature h3{margin-bottom:8px;color:#333}.feature p{color:#666;line-height:1.6}
.cta{text-align:center;padding:60px 20px;background:#f1f3f5}
.cta a{display:inline-block;padding:16px 40px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;border-radius:30px;font-size:1.1em;transition:transform .2s}
.cta a:hover{transform:scale(1.05)}</style></head>
<body><div class="hero"><h1>${c.heroTitle || '产品名称'}</h1><p>${c.heroSubtitle || '简洁而强大的产品描述'}</p></div>
<div class="features">${features || '<div class="feature"><div class="feature-icon">🚀</div><h3>核心功能</h3><p>描述你的产品核心功能</p></div>'}</div>
<div class="cta"><a href="#">立即体验</a></div></body></html>`;
}

function 生成数据看板HTML(c) {
  const charts = (c.charts || []).map((ch, i) =>
    `<div class="chart-card"><h3>${ch.title || '图表'}</h3><div id="chart_${i}" style="width:100%;height:300px"></div></div>`
  ).join('\n');

  const chartInits = (c.charts || []).map((ch, i) => {
    const chartType = ch.type || 'bar';
    const data = ch.data || {};
    return `var chart_${i} = echarts.init(document.getElementById('chart_${i}'));
chart_${i}.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:${JSON.stringify(data.xAxis || ['Mon','Tue','Wed','Thu','Fri'])}},yAxis:{type:'value'},series:[{type:'${chartType}',data:${JSON.stringify(data.series || [120,200,150,80,70])},itemStyle:{color:'#667eea'}}]});`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${c.heroTitle || '数据看板'}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;color:#333}
.header{background:#fff;padding:20px 40px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.header h1{font-size:1.5em;color:#333}
.dashboard{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:20px;padding:20px 40px}
.chart-card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.chart-card h3{margin-bottom:12px;color:#333}</style></head>
<body><div class="header"><h1>${c.heroTitle || '数据看板'}</h1></div>
<div class="dashboard">${charts || '<div class="chart-card"><h3>示例图表</h3><div id="chart_0" style="width:100%;height:300px"></div></div>'}</div>
<script>${chartInits || "var chart_0 = echarts.init(document.getElementById('chart_0'));chart_0.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:['Mon','Tue','Wed','Thu','Fri']},yAxis:{type:'value'},series:[{type:'bar',data:[120,200,150,80,70]}]});"}</script></body></html>`;
}

function 生成API调试HTML(c) {
  const endpoints = (c.endpoints || []).map(ep => {
    const methodColor = { GET: '#61affe', POST: '#49cc90', PUT: '#fca130', DELETE: '#f93e3e', PATCH: '#50e3c2' }[ep.method] || '#999';
    return `<div class="endpoint"><span class="method" style="background:${methodColor}">${ep.method || 'GET'}</span><span class="path">${ep.path || '/'}</span><span class="desc">${ep.description || ''}</span></div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${c.heroTitle || 'API调试'}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:monospace;background:#1a1a2e;color:#e0e0e0;display:flex;min-height:100vh}
.sidebar{width:280px;background:#16213e;padding:20px;overflow-y:auto}.sidebar h2{color:#fff;margin-bottom:16px}
.endpoint{padding:10px;border-radius:6px;margin-bottom:8px;cursor:pointer;transition:background .2s;display:flex;align-items:center;gap:8px}
.endpoint:hover{background:#1a1a4e}.method{padding:3px 8px;border-radius:3px;font-size:11px;font-weight:700;color:#fff;min-width:55px;text-align:center}
.path{color:#e0e0e0;font-size:13px}.desc{color:#888;font-size:12px;margin-left:auto}
.main{flex:1;padding:30px;display:flex;flex-direction:column;gap:20px}
.request-box,.response-box{background:#0f3460;border-radius:8px;padding:20px}
h3{color:#61affe;margin-bottom:12px}textarea{width:100%;height:80px;background:#1a1a2e;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:10px;font-family:monospace;font-size:13px}
button{background:#61affe;color:#fff;border:none;padding:10px 24px;border-radius:4px;cursor:pointer;font-size:14px;margin-top:10px}
button:hover{background:#4fa0e0}.response-box pre{background:#1a1a2e;padding:12px;border-radius:4px;overflow-x:auto;font-size:13px;color:#49cc90}</style></head>
<body><div class="sidebar"><h2>API接口</h2>${endpoints || '<div class="endpoint"><span class="method" style="background:#61affe">GET</span><span class="path">/api/example</span></div>'}</div>
<div class="main"><div class="request-box"><h3>Request</h3><textarea placeholder="请求参数（JSON）">{}</textarea><br><button onclick="tryApi()">Send</button></div>
<div class="response-box"><h3>Response</h3><pre id="response">点击 Send 发送请求...</pre></div></div>
<script>function tryApi(){document.getElementById('response').textContent='模拟响应：{\\n  "status": "ok",\\n  "data": {}\\n}';}</script></body></html>`;
}

function 生成表单DemoHTML(c) {
  const fields = (c.fields || []).map(f =>
    `<div class="form-group"><label for="${f.name}">${f.label || f.name}${f.required ? ' <span class="required">*</span>' : ''}</label><input type="${f.type || 'text'}" id="${f.name}" name="${f.name}" ${f.required ? 'required' : ''} placeholder="请输入${f.label || f.name}"></div>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${c.heroTitle || '表单Demo'}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.form-container{background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.08);width:100%;max-width:500px}
h1{text-align:center;margin-bottom:30px;color:#333}.form-group{margin-bottom:20px}
label{display:block;margin-bottom:6px;color:#555;font-size:14px;font-weight:500}
.required{color:#f93e3e}input,select,textarea{width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:14px;transition:border-color .2s}
input:focus,select:focus,textarea:focus{outline:none;border-color:#667eea;box-shadow:0 0 0 3px rgba(102,126,234,.1)}
button[type=submit]{width:100%;padding:14px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;transition:transform .2s;margin-top:10px}
button[type=submit]:hover{transform:translateY(-2px)}
.toast{position:fixed;top:20px;right:20px;padding:16px 24px;background:#49cc90;color:#fff;border-radius:8px;transform:translateX(120%);transition:transform .3s}
.toast.show{transform:translateX(0)}</style></head>
<body><div class="form-container"><h1>${c.heroTitle || '表单Demo'}</h1>
<form onsubmit="handleSubmit(event)">${fields || '<div class="form-group"><label>姓名 <span class="required">*</span></label><input type="text" required placeholder="请输入姓名"></div><div class="form-group"><label>邮箱 <span class="required">*</span></label><input type="email" required placeholder="请输入邮箱"></div>'}
<button type="submit">提交</button></form></div>
<div class="toast" id="toast">提交成功！</div>
<script>function handleSubmit(e){e.preventDefault();var t=document.getElementById('toast');t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000);}</script></body></html>`;
}

function 生成移动端预览HTML(c) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${c.heroTitle || '移动端预览'}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.phone{width:375px;height:812px;background:#fff;border-radius:44px;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden;position:relative;border:8px solid #1a1a2e}
.notch{width:150px;height:30px;background:#1a1a2e;border-radius:0 0 20px 20px;position:absolute;top:0;left:50%;transform:translateX(-50%);z-index:10}
.screen{height:100%;overflow-y:auto;background:#fff;padding:20px;padding-top:50px}
.app-header{text-align:center;margin-bottom:30px}
.app-header h1{font-size:24px;color:#333;margin-bottom:8px}
.app-header p{color:#888;font-size:14px}
.app-content{display:flex;flex-direction:column;gap:16px}
.card{background:#f8f9fa;border-radius:12px;padding:16px;transition:transform .2s}
.card:active{transform:scale(.98)}
.card h3{font-size:16px;color:#333;margin-bottom:8px}
.card p{font-size:13px;color:#666;line-height:1.5}
.tab-bar{position:absolute;bottom:0;left:0;right:0;height:80px;background:#fff;border-top:1px solid #eee;display:flex;justify-content:space-around;align-items:center;padding-bottom:20px}
.tab{display:flex;flex-direction:column;align-items:center;gap:4px;color:#999;font-size:11px}
.tab.active{color:#667eea}.tab-icon{font-size:20px}</style></head>
<body><div class="phone"><div class="notch"></div>
<div class="screen"><div class="app-header"><h1>${c.heroTitle || '移动应用'}</h1><p>${c.heroSubtitle || '移动端预览Demo'}</p></div>
<div class="app-content"><div class="card"><h3>功能一</h3><p>点击查看详细信息</p></div><div class="card"><h3>功能二</h3><p>点击查看详细信息</p></div><div class="card"><h3>功能三</h3><p>点击查看详细信息</p></div></div></div>
<div class="tab-bar"><div class="tab active"><span class="tab-icon">🏠</span>首页</div><div class="tab"><span class="tab-icon">🔍</span>搜索</div><div class="tab"><span class="tab-icon">👤</span>我的</div></div></div></body></html>`;
}

// ==================== 工具处理函数 ====================

export async function handleExtTool(name, args) {
  switch (name) {

    // ===== demo_create =====
    case 'demo_create': {
      const { title, template = 'custom', description = '', html, content, visibility = 'private', tags = [] } = args;

      if (!title) {
        return text({ error: '缺少必填参数: title' });
      }

      const demoId = 生成DemoID();
      const createdAt = new Date().toISOString();

      // 生成HTML
      let finalHtml = html;
      if (!finalHtml && template !== 'custom') {
        finalHtml = 根据模板生成HTML(template, content);
      }
      if (!finalHtml) {
        return text({
          action: 'demo_create',
          demoId,
          template,
          hint: '请生成完整的HTML内容，然后使用 demo_create 再次提交（传入 html 参数）。可参考 demo_template_list 中的模板。'
        });
      }

      // 尝试托管到OSS
      let ossUrl = null;
      try {
        const { handleExtTool: pageHandle } = await import('../../tools/页面托管.js');
        const hostResult = await pageHandle('页面托管', {
          title: `[Demo] ${title}`,
          html: finalHtml,
          visibility,
          expiresIn: 0
        });
        // 从返回中提取URL
        const hostText = hostResult?.content?.[0]?.text;
        if (hostText) {
          try {
            const parsed = JSON.parse(hostText);
            ossUrl = parsed.url;
          } catch { /* 解析失败 */ }
        }
      } catch (e) {
        logger.info(`页面托管调用失败，Demo仅保存在内存: ${e.message}`);
      }

      // 保存到内存缓存
      const demoData = {
        demoId, title, template, description, html: finalHtml, content,
        visibility, tags, createdAt, url: ossUrl
      };
      _demo缓存.set(demoId, demoData);

      logger.info(`Demo已创建: ${demoId} "${title}" (${template}) ${ossUrl ? '(OSS)' : '(内存)'}`);

      return text({
        action: 'demo_create',
        demoId,
        title,
        template,
        url: ossUrl || `memory://${demoId}`,
        storage: ossUrl ? 'oss' : 'memory',
        createdAt
      });
    }

    // ===== demo_update =====
    case 'demo_update': {
      const { demoId, title, html, content, tags } = args;

      if (!demoId) {
        return text({ error: '缺少必填参数: demoId' });
      }

      const 现有 = _demo缓存.get(demoId);
      if (!现有) {
        return text({ error: `Demo不存在: ${demoId}` });
      }

      if (title) 现有.title = title;
      if (html) 现有.html = html;
      if (content) {
        现有.content = content;
        // 重新根据模板生成HTML
        const newHtml = 根据模板生成HTML(现有.template, content);
        if (newHtml) 现有.html = newHtml;
      }
      if (tags) 现有.tags = tags;
      现有.updatedAt = new Date().toISOString();

      // 更新OSS
      if (现有.html) {
        try {
          const { handleExtTool: pageHandle } = await import('../../tools/页面托管.js');
          // 尝试用pageId更新，如果有的话
          const pageId = 现有.pageId;
          if (pageId) {
            await pageHandle('页面更新', { pageId, html: 现有.html, title: 现有.title });
          }
        } catch { /* 忽略 */ }
      }

      logger.info(`Demo已更新: ${demoId} "${现有.title}"`);

      return text({
        action: 'demo_update',
        demoId,
        title: 现有.title,
        url: 现有.url || `memory://${demoId}`,
        updatedAt: 现有.updatedAt
      });
    }

    // ===== demo_from_data =====
    case 'demo_from_data': {
      const { title, data, chartType = 'bar', options = {}, visibility = 'private' } = args;

      if (!title || !data) {
        return text({ error: '缺少必填参数: title 和 data' });
      }

      const theme = options.theme || 'light';
      const bgColor = theme === 'dark' ? '#1a1a2e' : '#fff';
      const textColor = theme === 'dark' ? '#e0e0e0' : '#333';

      // 生成ECharts配置
      let chartOption;
      if (chartType === 'table') {
        // 表格模式
        const headers = data.headers || Object.keys(data.rows?.[0] || {});
        const rows = data.rows || [];
        const headerHtml = headers.map(h => `<th>${h}</th>`).join('');
        const rowHtml = rows.map(r => `<tr>${headers.map(h => `<td>${r[h] || ''}</td>`).join('')}</tr>`).join('');

        const tableHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:${bgColor};color:${textColor};padding:40px}
h1{margin-bottom:20px}table{width:100%;border-collapse:collapse;background:${theme==='dark'?'#16213e':'#fff'};border-radius:8px;overflow:hidden}
th{background:${theme==='dark'?'#0f3460':'#f8f9fa'};padding:12px;text-align:left;font-weight:600}
td{padding:12px;border-top:1px solid ${theme==='dark'?'#1a1a4e':'#eee'}}</style></head>
<body><h1>${title}</h1><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table></body></html>`;

        const demoId = 生成DemoID();
        _demo缓存.set(demoId, { demoId, title, html: tableHtml, chartType, data, visibility, createdAt: new Date().toISOString() });

        return text({ action: 'demo_from_data', demoId, title, chartType: 'table', url: `memory://${demoId}` });
      }

      // 图表模式 - 使用ECharts
      const echartsOption = {
        tooltip: { trigger: chartType === 'pie' ? 'item' : 'axis' },
        legend: {},
        xAxis: chartType !== 'pie' ? { type: 'category', data: data.xAxis || [] } : undefined,
        yAxis: chartType !== 'pie' ? { type: 'value' } : undefined,
        series: data.series || [{ type: chartType, data: data.values || [] }]
      };

      const chartHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title><script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:${bgColor};color:${textColor};padding:20px}
h1{margin-bottom:20px}.chart{width:100%;height:500px;background:${theme==='dark'?'#16213e':'#fff'};border-radius:8px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.06)}</style></head>
<body><h1>${title}</h1><div class="chart" id="chart"></div>
<script>var chart=echarts.init(document.getElementById('chart'));chart.setOption(${JSON.stringify(echartsOption)});window.addEventListener('resize',()=>chart.resize());</script></body></html>`;

      const demoId = 生成DemoID();
      _demo缓存.set(demoId, { demoId, title, html: chartHtml, chartType, data, visibility, createdAt: new Date().toISOString() });

      // 尝试托管
      let ossUrl = null;
      try {
        const { handleExtTool: pageHandle } = await import('../../tools/页面托管.js');
        const hostResult = await pageHandle('page_host', { title: `[Demo] ${title}`, html: chartHtml, visibility });
        const hostText = hostResult?.content?.[0]?.text;
        if (hostText) {
          try { ossUrl = JSON.parse(hostText).url; } catch { /* */ }
        }
      } catch { /* */ }

      const cached = _demo缓存.get(demoId);
      if (cached && ossUrl) cached.url = ossUrl;

      logger.info(`数据Demo已创建: ${demoId} "${title}" (${chartType})`);

      return text({
        action: 'demo_from_data',
        demoId,
        title,
        chartType,
        url: ossUrl || `memory://${demoId}`,
        storage: ossUrl ? 'oss' : 'memory'
      });
    }

    // ===== demo_template_list =====
    case 'demo_template_list': {
      const { category } = args;
      let templates = Object.values(DEMO_TEMPLATES);

      if (category) {
        templates = templates.filter(t =>
          t.name.includes(category) || t.id.includes(category) || t.description.includes(category)
        );
      }

      return text({
        action: 'demo_template_list',
        total: templates.length,
        templates: templates.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          sections: t.sections,
          techStack: t.techStack,
          thumbnail: t.thumbnail
        }))
      });
    }

    // ===== demo_share =====
    case 'demo_share': {
      const { demoId, expiresIn = 0, generateQR = false } = args;

      if (!demoId) {
        return text({ error: '缺少必填参数: demoId' });
      }

      const demo = _demo缓存.get(demoId);
      if (!demo) {
        return text({ error: `Demo不存在: ${demoId}` });
      }

      const shareUrl = demo.url || `memory://${demoId}`;
      const shareToken = randomBytes(8).toString('hex');

      const result = {
        action: 'demo_share',
        demoId,
        title: demo.title,
        shareUrl,
        shareToken,
        expiresIn: expiresIn > 0 ? `${expiresIn}秒` : '永久',
        createdAt: new Date().toISOString()
      };

      // 二维码生成（如果需要）
      if (generateQR) {
        result.qrHint = '可使用第三方QR码API生成二维码图片，如：https://api.qrserver.com/v1/create-qr-code/?data=' + encodeURIComponent(shareUrl);
      }

      return text(result);
    }

    default:
      return null; // 不认识的工具返回 null，让其他扩展处理
  }
}
