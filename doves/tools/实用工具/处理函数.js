/**
 * @file tools/实用工具/处理函数
 * @description 处理所有实用工具调用，包含编解码、哈希加密、JSON、正则、时间、数据转换、验证
 */

import { createHash, createHmac, randomBytes } from 'crypto';

// HTML 实体映射
const htmlEntities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/**
 * 工具处理函数
 */
export async function handleUtilsTool(name, args) {
  const text = (content) => ({ content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }] });
  
  try {
    switch (name) {
      // 编码/解码
      case 'Base64编码': {
        const encoded = Buffer.from(args.text, 'utf-8').toString('base64');
        return text({ original: args.text, encoded });
      }
      case 'Base64解码': {
        const decoded = Buffer.from(args.text, 'base64').toString('utf-8');
        return text({ encoded: args.text, decoded });
      }
      case 'URL编码': {
        return text({ original: args.text, encoded: encodeURIComponent(args.text) });
      }
      case 'URL解码': {
        return text({ encoded: args.text, decoded: decodeURIComponent(args.text) });
      }
      case 'HTML编码': {
        const encoded = args.text.replace(/[&<>"']/g, c => htmlEntities[c]);
        return text({ original: args.text, encoded });
      }
      case 'HTML解码': {
        const decoded = args.text
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        return text({ encoded: args.text, decoded });
      }
      
      // 哈希/加密
      case '哈希计算': {
        const algorithm = args.algorithm || 'sha256';
        const hash = createHash(algorithm).update(args.text, 'utf-8').digest('hex');
        return text({ text: args.text, algorithm, hash });
      }
      case 'HMAC计算': {
        const algorithm = args.algorithm || 'sha256';
        const hmac = createHmac(algorithm, args.key).update(args.text, 'utf-8').digest('hex');
        return text({ text: args.text, algorithm, hmac });
      }
      case 'UUID生成': {
        if (args.version === 'v1') {
          // 简化版 v1 UUID
          const now = Date.now();
          const random = randomBytes(8).toString('hex');
          const uuid = `${(now & 0xFFFFFFFF).toString(16).padStart(8, '0')}-${((now >> 32) & 0xFFFF).toString(16).padStart(4, '0')}-1${random.substring(0, 3)}-${random.substring(3, 7)}-${random.substring(7, 15).padEnd(12, '0')}`;
          return text({ uuid, version: 'v1' });
        }
        // v4 UUID
        const bytes = randomBytes(16);
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
        const uuid = [
          bytes.toString('hex', 0, 4),
          bytes.toString('hex', 4, 6),
          bytes.toString('hex', 6, 8),
          bytes.toString('hex', 8, 10),
          bytes.toString('hex', 10, 16)
        ].join('-');
        return text({ uuid, version: 'v4' });
      }
      case '随机数生成': {
        const length = args.length || 16;
        const type = args.type || 'hex';
        const bytes = randomBytes(length);
        const result = type === 'number' 
          ? Math.floor(Math.random() * Math.pow(10, length))
          : bytes.toString(type === 'base64' ? 'base64' : 'hex');
        return text({ type, length, result: type === 'number' ? result : result.substring(0, length * 2) });
      }
      
      // JSON 处理
      case 'JSON解析': {
        const parsed = JSON.parse(args.text);
        return text({ parsed });
      }
      case 'JSON序列化': {
        const result = args.pretty !== false 
          ? JSON.stringify(args.object, null, 2) 
          : JSON.stringify(args.object);
        return text({ stringified: result });
      }
      case 'JSON路径': {
        // 简化版 JSONPath 实现
        const result = jsonPathQuery(args.object, args.path);
        return text({ path: args.path, result });
      }
      
      // 正则/字符串
      case '正则匹配': {
        const regex = new RegExp(args.pattern, args.flags || '');
        const matches = args.text.match(regex);
        return text({ 
          pattern: args.pattern, 
          flags: args.flags,
          matches: matches || [],
          matchCount: matches ? matches.length : 0
        });
      }
      case '正则替换': {
        const regex = new RegExp(args.pattern, args.flags || 'g');
        const result = args.text.replace(regex, args.replacement);
        return text({ original: args.text, pattern: args.pattern, result });
      }
      case '模板渲染': {
        const result = args.template.replace(/\{\{(\w+)\}\}/g, (_, key) => args.data[key] ?? '');
        return text({ template: args.template, data: args.data, result });
      }
      
      // 时间处理
      case '时间戳转换': {
        let date;
        if (args.value) {
          date = /^\d+$/.test(args.value) ? new Date(parseInt(args.value)) : new Date(args.value);
        } else {
          date = new Date();
        }
        const format = args.format || 'iso';
        const result = format === 'timestamp' ? date.getTime() 
          : format === 'local' ? date.toLocaleString('zh-CN') 
          : date.toISOString();
        return text({ 
          input: args.value || 'now',
          format,
          result,
          iso: date.toISOString(),
          local: date.toLocaleString('zh-CN'),
          timestamp: date.getTime()
        });
      }
      case '日期计算': {
        const date = args.date ? new Date(args.date) : new Date();
        const value = args.operation === 'subtract' ? -args.value : args.value;
        const unitMs = { days: 86400000, hours: 3600000, minutes: 60000, seconds: 1000 };
        const newDate = new Date(date.getTime() + value * unitMs[args.unit]);
        return text({
          original: date.toISOString(),
          operation: args.operation,
          value: args.value,
          unit: args.unit,
          result: newDate.toISOString(),
          resultLocal: newDate.toLocaleString('zh-CN')
        });
      }
      
      // 数据转换
      case '大小写转换': {
        const result = convertCase(args.text, args.to);
        return text({ original: args.text, format: args.to, result });
      }
      case '进制转换': {
        const num = parseInt(args.value, args.from || 10);
        const result = num.toString(args.to || 10);
        return text({ 
          original: args.value, 
          fromBase: args.from || 10, 
          toBase: args.to || 10, 
          result,
          decimal: num
        });
      }
      case '颜色转换': {
        const result = convertColor(args.color, args.to);
        return text({ original: args.color, format: args.to, result });
      }
      
      // 验证
      case '格式验证': {
        const result = validateFormat(args.text, args.type);
        return text({ text: args.text, type: args.type, valid: result.valid, message: result.message });
      }
      
      default:
        return { content: [{ type: 'text', text: `Unknown utils tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return text({ error: error.message });
  }
}

// 简化版 JSONPath 查询
function jsonPathQuery(obj, path) {
  if (!path.startsWith('$')) return null;
  
  path = path.substring(2); // 移除 $.
  const parts = path.split(/\.|\[|\]/).filter(p => p);
  
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return null;
    
    if (part === '*') {
      if (Array.isArray(current)) {
        return current;
      } else if (typeof current === 'object') {
        return Object.values(current);
      }
    } else if (/^\d+$/.test(part)) {
      current = current[parseInt(part)];
    } else {
      current = current[part];
    }
  }
  return current;
}

// 大小写转换
function convertCase(text, to) {
  switch (to) {
    case 'upper': return text.toUpperCase();
    case 'lower': return text.toLowerCase();
    case 'camel': 
      return text.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '').replace(/^(.)/, c => c.toLowerCase());
    case 'snake':
      return text.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase();
    case 'kebab':
      return text.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
    case 'pascal':
      return text.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '').replace(/^(.)/, c => c.toUpperCase());
    default:
      return text;
  }
}

// 颜色转换
function convertColor(color, to) {
  let r, g, b;
  
  // 解析输入
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    r = parseInt(hex.substr(0, 2), 16);
    g = parseInt(hex.substr(2, 2), 16);
    b = parseInt(hex.substr(4, 2), 16);
  } else if (color.startsWith('rgb')) {
    const match = color.match(/(\d+)/g);
    [r, g, b] = match.map(Number);
  } else {
    return { error: '不支持的颜色格式' };
  }
  
  // 转换输出
  switch (to) {
    case 'hex':
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    case 'rgb':
      return `rgb(${r}, ${g}, ${b})`;
    case 'hsl': {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;
      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6; break;
          case b: h = ((r - g) / d + 4) / 6; break;
        }
      }
      return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
    }
    default:
      return { error: '不支持的目标格式' };
  }
}

// 格式验证
function validateFormat(text, type) {
  const patterns = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    url: /^https?:\/\/[^\s<>"]+$/,
    ip: /^(\d{1,3}\.){3}\d{1,3}$/,
    phone: /^1[3-9]\d{9}$/,
    json: /^[\s\S]*$/,
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  };
  
  const messages = {
    email: '邮箱格式',
    url: 'URL 格式',
    ip: 'IP 地址格式',
    phone: '手机号格式',
    json: 'JSON 格式',
    uuid: 'UUID 格式'
  };
  
  if (type === 'json') {
    try {
      JSON.parse(text);
      return { valid: true, message: '有效的 JSON' };
    } catch {
      return { valid: false, message: '无效的 JSON' };
    }
  }
  
  const pattern = patterns[type];
  if (!pattern) {
    return { valid: false, message: '未知的验证类型' };
  }
  
  const valid = pattern.test(text);
  return { valid, message: valid ? `有效的${messages[type]}` : `无效的${messages[type]}` };
}
