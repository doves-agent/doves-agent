/**
 * @file tools/实用工具/工具定义
 * @description 实用工具的工具定义数组（编解码、哈希加密、JSON、正则、时间、数据转换、验证）
 */

export const utilsTools = [
  // 编码/解码
  {
    name: 'Base64编码',
    description: 'Base64 编码',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要编码的文本' }
      },
      required: ['text']
    }
  },
  {
    name: 'Base64解码',
    description: 'Base64 解码',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要解码的 Base64 文本' }
      },
      required: ['text']
    }
  },
  {
    name: 'URL编码',
    description: 'URL 编码',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要编码的文本' }
      },
      required: ['text']
    }
  },
  {
    name: 'URL解码',
    description: 'URL 解码',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要解码的文本' }
      },
      required: ['text']
    }
  },
  {
    name: 'HTML编码',
    description: 'HTML 实体编码',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要编码的文本' }
      },
      required: ['text']
    }
  },
  {
    name: 'HTML解码',
    description: 'HTML 实体解码',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要解码的文本' }
      },
      required: ['text']
    }
  },
  
  // 哈希/加密
  {
    name: '哈希计算',
    description: '计算文本哈希值（支持 md5, sha1, sha256, sha512）',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要哈希的文本' },
        algorithm: { type: 'string', description: '算法: md5, sha1, sha256, sha512', default: 'sha256' }
      },
      required: ['text']
    }
  },
  {
    name: 'HMAC计算',
    description: '计算 HMAC 值',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要签名的文本' },
        key: { type: 'string', description: '密钥' },
        algorithm: { type: 'string', description: '算法: sha256, sha512', default: 'sha256' }
      },
      required: ['text', 'key']
    }
  },
  {
    name: 'UUID生成',
    description: '生成 UUID',
    inputSchema: {
      type: 'object',
      properties: {
        version: { type: 'string', description: '版本: v4(随机) 或 v1(时间)', default: 'v4' }
      }
    }
  },
  {
    name: '随机数生成',
    description: '生成随机字符串或数字',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '类型: hex, base64, number', default: 'hex' },
        length: { type: 'number', description: '长度(字节数)', default: 16 }
      }
    }
  },
  
  // JSON 处理
  {
    name: 'JSON解析',
    description: '解析 JSON 字符串',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'JSON 字符串' }
      },
      required: ['text']
    }
  },
  {
    name: 'JSON序列化',
    description: '将对象序列化为 JSON',
    inputSchema: {
      type: 'object',
      properties: {
        object: { type: 'object', description: '要序列化的对象' },
        pretty: { type: 'boolean', description: '是否格式化', default: true }
      },
      required: ['object']
    }
  },
  {
    name: 'JSON路径',
    description: '使用 JSONPath 提取数据',
    inputSchema: {
      type: 'object',
      properties: {
        object: { type: 'object', description: 'JSON 对象' },
        path: { type: 'string', description: 'JSONPath 表达式，如 $.store.book[*].author' }
      },
      required: ['object', 'path']
    }
  },
  
  // 正则/字符串
  {
    name: '正则匹配',
    description: '正则表达式匹配',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要匹配的文本' },
        pattern: { type: 'string', description: '正则表达式' },
        flags: { type: 'string', description: '标志: g, i, m 等', default: '' }
      },
      required: ['text', 'pattern']
    }
  },
  {
    name: '正则替换',
    description: '正则表达式替换',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '原始文本' },
        pattern: { type: 'string', description: '正则表达式' },
        replacement: { type: 'string', description: '替换文本' },
        flags: { type: 'string', description: '标志: g, i, m 等', default: 'g' }
      },
      required: ['text', 'pattern', 'replacement']
    }
  },
  {
    name: '模板渲染',
    description: '字符串模板渲染',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: '模板，如: Hello {{name}}!' },
        data: { type: 'object', description: '数据对象' }
      },
      required: ['template', 'data']
    }
  },
  
  // 时间处理
  {
    name: '时间戳转换',
    description: '时间戳转换',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: '时间戳或日期字符串，留空返回当前时间戳' },
        format: { type: 'string', description: '输出格式: iso, local, timestamp' }
      }
    }
  },
  {
    name: '日期计算',
    description: '日期计算',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '起始日期，留空为当前时间' },
        operation: { type: 'string', description: '操作: add 或 subtract' },
        value: { type: 'number', description: '数值' },
        unit: { type: 'string', description: '单位: days, hours, minutes, seconds' }
      },
      required: ['operation', 'value', 'unit']
    }
  },
  
  // 数据转换
  {
    name: '大小写转换',
    description: '字符串大小写转换',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '原始文本' },
        to: { type: 'string', description: '目标格式: upper, lower, camel, snake, kebab, pascal' }
      },
      required: ['text', 'to']
    }
  },
  {
    name: '进制转换',
    description: '数字进制转换',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: '数值' },
        from: { type: 'number', description: '原进制', default: 10 },
        to: { type: 'number', description: '目标进制', default: 10 }
      },
      required: ['value']
    }
  },
  {
    name: '颜色转换',
    description: '颜色格式转换',
    inputSchema: {
      type: 'object',
      properties: {
        color: { type: 'string', description: '颜色值，如 #FF0000 或 rgb(255,0,0)' },
        to: { type: 'string', description: '目标格式: hex, rgb, hsl' }
      },
      required: ['color', 'to']
    }
  },
  
  // 验证
  {
    name: '格式验证',
    description: '验证常见格式（邮箱、URL、IP等）',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要验证的文本' },
        type: { type: 'string', description: '类型: email, url, ip, phone, json, uuid' }
      },
      required: ['text', 'type']
    }
  }
];
