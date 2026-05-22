/**
 * @file skills/技能验证器
 * @description 技能参数验证器，支持 JSON Schema 风格的参数验证
 */

/**
 * 验证技能参数（增强版 JSON Schema 验证）
 * @param {Object} 技能 - 技能模块
 * @param {Object} 参数 - 执行参数
 * @returns {Object} 验证结果 { valid: boolean, errors: Array, warnings: Array }
 */
export function 验证技能参数(技能, 参数) {
  const errors = [];
  const warnings = [];
  
  if (!技能.parameters) {
    return { valid: true, errors: [], warnings: [] };
  }
  
  const schema = 技能.parameters;
  const validatedParams = { ...参数 };
  
  // 1. 检查必填参数
  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (validatedParams[field] === undefined || validatedParams[field] === null) {
        errors.push(`缺少必填参数: ${field}`);
      }
    }
  }
  
  // 2. 如果有错误，直接返回
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }
  
  // 3. 验证参数属性
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const value = validatedParams[key];
      
      // 参数不存在且有默认值，填充默认值
      if (value === undefined && prop.default !== undefined) {
        validatedParams[key] = prop.default;
        continue;
      }
      
      // 参数不存在，跳过验证
      if (value === undefined || value === null) {
        continue;
      }
      
      // 验证单个属性
      const propResult = 验证属性(key, value, prop);
      errors.push(...propResult.errors);
      warnings.push(...propResult.warnings);
    }
  }
  
  // 4. 检查额外属性（如果不允许）
  if (schema.additionalProperties === false && schema.properties) {
    const allowedKeys = Object.keys(schema.properties);
    const actualKeys = Object.keys(validatedParams);
    for (const key of actualKeys) {
      if (!allowedKeys.includes(key)) {
        warnings.push(`未知参数: ${key}（将被忽略）`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    params: validatedParams
  };
}

/**
 * 验证单个属性
 */
function 验证属性(key, value, prop) {
  const errors = [];
  const warnings = [];
  
  // 获取期望类型（可能是数组）
  const expectedTypes = Array.isArray(prop.type) ? prop.type : [prop.type];
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  
  // 类型验证
  if (prop.type && !检查类型(actualType, expectedTypes, value)) {
    // 尝试类型转换
    const 转换结果 = 尝试类型转换(value, expectedTypes);
    if (转换结果.success) {
      warnings.push(`参数 ${key} 已自动转换类型`);
    } else {
      errors.push(`参数 ${key} 类型错误: 期望 ${expectedTypes.join(' | ')}, 实际 ${actualType}`);
      return { errors, warnings };
    }
  }
  
  // 枚举值验证
  if (prop.enum && !prop.enum.includes(value)) {
    errors.push(`参数 ${key} 值无效: 必须是 ${prop.enum.join(' | ')} 之一`);
    return { errors, warnings };
  }
  
  // 数值范围验证
  if (actualType === 'number') {
    if (prop.minimum !== undefined && value < prop.minimum) {
      errors.push(`参数 ${key} 值 ${value} 小于最小值 ${prop.minimum}`);
    }
    if (prop.maximum !== undefined && value > prop.maximum) {
      errors.push(`参数 ${key} 值 ${value} 大于最大值 ${prop.maximum}`);
    }
    if (prop.exclusiveMinimum !== undefined && value <= prop.exclusiveMinimum) {
      errors.push(`参数 ${key} 值 ${value} 必须大于 ${prop.exclusiveMinimum}`);
    }
    if (prop.exclusiveMaximum !== undefined && value >= prop.exclusiveMaximum) {
      errors.push(`参数 ${key} 值 ${value} 必须小于 ${prop.exclusiveMaximum}`);
    }
  }
  
  // 字符串验证
  if (actualType === 'string') {
    if (prop.minLength !== undefined && value.length < prop.minLength) {
      errors.push(`参数 ${key} 长度 ${value.length} 小于最小长度 ${prop.minLength}`);
    }
    if (prop.maxLength !== undefined && value.length > prop.maxLength) {
      errors.push(`参数 ${key} 长度 ${value.length} 大于最大长度 ${prop.maxLength}`);
    }
    if (prop.pattern) {
      const regex = new RegExp(prop.pattern);
      if (!regex.test(value)) {
        errors.push(`参数 ${key} 值 "${value}" 不匹配模式 ${prop.pattern}`);
      }
    }
    if (prop.format) {
      const formatResult = 验证格式(value, prop.format);
      if (!formatResult.valid) {
        errors.push(`参数 ${key} ${formatResult.error}`);
      }
    }
  }
  
  // 数组验证
  if (actualType === 'array') {
    if (prop.minItems !== undefined && value.length < prop.minItems) {
      errors.push(`参数 ${key} 数组长度 ${value.length} 小于最小长度 ${prop.minItems}`);
    }
    if (prop.maxItems !== undefined && value.length > prop.maxItems) {
      errors.push(`参数 ${key} 数组长度 ${value.length} 大于最大长度 ${prop.maxItems}`);
    }
    if (prop.items && prop.items.type) {
      for (let i = 0; i < value.length; i++) {
        const itemResult = 验证属性(`${key}[${i}]`, value[i], prop.items);
        errors.push(...itemResult.errors);
        warnings.push(...itemResult.warnings);
      }
    }
  }
  
  // 嵌套对象验证
  if (actualType === 'object' && prop.properties) {
    const nestedResult = 验证技能参数({ parameters: prop }, value);
    errors.push(...nestedResult.errors.map(e => `${key}.${e}`));
    warnings.push(...nestedResult.warnings.map(w => `${key}.${w}`));
  }
  
  return { errors, warnings };
}

/**
 * 检查类型是否匹配
 */
function 检查类型(actualType, expectedTypes, value) {
  for (const expected of expectedTypes) {
    if (actualType === expected) return true;
    // 宽松匹配：integer 是 number 的子集
    if (expected === 'integer' && actualType === 'number' && Number.isInteger(value)) return true;
    if (expected === 'number' && actualType === 'integer') return true;
  }
  return false;
}

/**
 * 尝试类型转换
 */
function 尝试类型转换(value, expectedTypes) {
  const actualType = typeof value;
  
  for (const expected of expectedTypes) {
    // string 转 number
    if (expected === 'number' && actualType === 'string') {
      const num = Number(value);
      if (!isNaN(num)) return { success: true, value: num };
    }
    // number 转 string
    if (expected === 'string' && (actualType === 'number' || actualType === 'boolean')) {
      return { success: true, value: String(value) };
    }
    // boolean 转换
    if (expected === 'boolean') {
      if (value === 'true' || value === '1') return { success: true, value: true };
      if (value === 'false' || value === '0') return { success: true, value: false };
    }
  }
  
  return { success: false };
}

/**
 * 验证字符串格式
 */
function 验证格式(value, format) {
  const formats = {
    'email': {
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      error: '不是有效的邮箱地址'
    },
    'uri': {
      pattern: /^https?:\/\/[^\s]+$/,
      error: '不是有效的 URL'
    },
    'date': {
      pattern: /^\d{4}-\d{2}-\d{2}$/,
      error: '不是有效的日期格式 (YYYY-MM-DD)'
    },
    'date-time': {
      pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      error: '不是有效的日期时间格式'
    },
    'uuid': {
      pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      error: '不是有效的 UUID'
    }
  };
  
  const formatDef = formats[format];
  if (formatDef) {
    if (!formatDef.pattern.test(value)) {
      return { valid: false, error: formatDef.error };
    }
  }
  
  return { valid: true };
}
