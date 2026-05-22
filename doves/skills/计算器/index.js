/**
 * 计算器技能
 * 
 * 支持数学运算：
 * - 基础运算：加减乘除、取模、幂运算
 * - 数学函数：sqrt、abs、log、sin、cos、tan 等
 * - 常量：pi、e
 * - 进制转换
 * - 单位换算
 * 
 * 设计原则：
 * - 参数自包含，不依赖外部上下文
 * - 无状态执行，支持并发调用
 * - 安全计算，禁止代码注入
 */

// ============================================================================
// 日志器
// ============================================================================

import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('计算器', { 前缀: '[计算器]', 级别: 'debug', 显示调用位置: true });

// ============================================================================
// 安全配置
// ============================================================================

// 允许的数学函数和常量
const MATH_FUNCTIONS = {
  // 基础函数
  'abs': Math.abs,
  'ceil': Math.ceil,
  'floor': Math.floor,
  'round': Math.round,
  'sqrt': Math.sqrt,
  'cbrt': Math.cbrt,
  
  // 幂和对数
  'pow': Math.pow,
  'exp': Math.exp,
  'log': Math.log,
  'log10': Math.log10,
  'log2': Math.log2,
  
  // 三角函数
  'sin': Math.sin,
  'cos': Math.cos,
  'tan': Math.tan,
  'asin': Math.asin,
  'acos': Math.acos,
  'atan': Math.atan,
  'atan2': Math.atan2,
  
  // 双曲函数
  'sinh': Math.sinh,
  'cosh': Math.cosh,
  'tanh': Math.tanh,
  
  // 其他
  'min': Math.min,
  'max': Math.max,
  'random': Math.random,
  'sign': Math.sign,
  'trunc': Math.trunc
};

// 数学常量
const MATH_CONSTANTS = {
  'pi': Math.PI,
  'e': Math.E,
  'ln2': Math.LN2,
  'ln10': Math.LN10,
  'sqrt2': Math.SQRT2,
  'sqrt1_2': Math.SQRT1_2
};

// ============================================================================
// 计算函数
// ============================================================================

/**
 * 安全计算数学表达式
 * @param {string} expression - 数学表达式
 * @returns {Object} 计算结果
 */
function safeEval(expression) {
  // 预处理：替换常量
  let processedExpr = expression.toLowerCase();
  for (const [name, value] of Object.entries(MATH_CONSTANTS)) {
    const regex = new RegExp(`\\b${name}\\b`, 'g');
    processedExpr = processedExpr.replace(regex, `(${value})`);
  }
  
  // 安全检查：只允许数字、运算符、括号、空格和已定义的函数
  const allowedPattern = /^[\d\s+\-*/().%^,%]+$/;
  if (!allowedPattern.test(processedExpr)) {
    // 检查是否包含函数名
    const funcPattern = /\b[a-zA-Z_]+\b/g;
    const matches = processedExpr.match(funcPattern);
    if (matches) {
      for (const match of matches) {
        if (!MATH_FUNCTIONS[match.toLowerCase()]) {
          return {
            success: false,
            error: `不允许的标识符: ${match}`
          };
        }
      }
    }
  }
  
  // 替换数学函数为 Math.xxx 形式
  for (const [name] of Object.entries(MATH_FUNCTIONS)) {
    const regex = new RegExp(`\\b${name}\\b`, 'gi');
    processedExpr = processedExpr.replace(regex, `Math.${name}`);
  }
  
  // 安全执行
  try {
    // 使用 Function 构造器，比 eval 更安全
    const result = new Function(`"use strict"; return (${processedExpr})`)();
    
    if (typeof result !== 'number' || !isFinite(result)) {
      if (isNaN(result)) {
        return { success: false, error: '计算结果为 NaN' };
      }
      if (!isFinite(result)) {
        return { success: false, error: '计算结果超出范围（无穷大）' };
      }
    }
    
    return { success: true, result };
  } catch (error) {
    return { success: false, error: `计算错误: ${error.message}` };
  }
}

/**
 * 进制转换
 * @param {string|number} value - 要转换的值
 * @param {number} fromBase - 原始进制
 * @param {number} toBase - 目标进制
 * @returns {Object} 转换结果
 */
function convertBase(value, fromBase, toBase) {
  try {
    // 先转为十进制
    const decimal = parseInt(String(value), fromBase);
    
    if (isNaN(decimal)) {
      return { success: false, error: '无效的数值' };
    }
    
    // 再从十进制转为目标进制
    const result = decimal.toString(toBase).toUpperCase();
    
    return {
      success: true,
      result,
      decimal,
      fromBase,
      toBase
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 单位换算
 * @param {number} value - 数值
 * @param {string} from - 原始单位
 * @param {string} to - 目标单位
 * @returns {Object} 换算结果
 */
function convertUnit(value, from, to) {
  const units = {
    // 长度（米为基准）
    'm': 1,
    'km': 1000,
    'cm': 0.01,
    'mm': 0.001,
    'mi': 1609.344,
    'ft': 0.3048,
    'in': 0.0254,
    
    // 重量（千克为基准）
    'kg': 1,
    'g': 0.001,
    'mg': 0.000001,
    'lb': 0.453592,
    'oz': 0.0283495,
    
    // 温度需要特殊处理
  };
  
  // 温度换算
  const temperatureUnits = ['c', 'f', 'k'];
  from = from.toLowerCase();
  to = to.toLowerCase();
  
  if (temperatureUnits.includes(from) && temperatureUnits.includes(to)) {
    let celsius;
    
    // 先转为摄氏度
    if (from === 'c') celsius = value;
    else if (from === 'f') celsius = (value - 32) * 5 / 9;
    else if (from === 'k') celsius = value - 273.15;
    
    // 再从摄氏度转为目标单位
    let result;
    if (to === 'c') result = celsius;
    else if (to === 'f') result = celsius * 9 / 5 + 32;
    else if (to === 'k') result = celsius + 273.15;
    
    return {
      success: true,
      result: Math.round(result * 100) / 100,
      from,
      to,
      type: 'temperature'
    };
  }
  
  // 普通单位换算
  if (units[from] && units[to]) {
    const baseValue = value * units[from];
    const result = baseValue / units[to];
    
    return {
      success: true,
      result: Math.round(result * 1000000) / 1000000,
      from,
      to,
      type: 'length/weight'
    };
  }
  
  return {
    success: false,
    error: `不支持的单位: ${from} -> ${to}`
  };
}

/**
 * 求解方程
 * @param {string} equation - 方程表达式，如 "2x + 3 = 7"
 * @returns {Object} 解
 */
function solveEquation(equation) {
  // 简化版：只支持一元一次方程
  // 格式：ax + b = c
  const match = equation.replace(/\s/g, '').match(/([+-]?\d*\.?\d*)x([+-]\d+\.?\d*)?=([+-]?\d+\.?\d*)/);
  
  if (!match) {
    return {
      success: false,
      error: '方程格式不支持，目前只支持一元一次方程（如 2x+3=7）'
    };
  }
  
  const a = parseFloat(match[1]) || 1;
  const b = parseFloat(match[2]) || 0;
  const c = parseFloat(match[3]) || 0;
  
  if (a === 0) {
    return {
      success: false,
      error: '系数 a 不能为 0'
    };
  }
  
  const x = (c - b) / a;
  
  return {
    success: true,
    result: x,
    equation,
    solution: `x = ${x}`
  };
}

// ============================================================================
// 主执行函数
// ============================================================================

async function execute(args, context) {
  const {
    action = 'calculate',
    expression,
    value,
    from,
    to,
    from_base,
    to_base,
    equation
  } = args;

  logger.info(`执行: ${action}`);

  try {
    switch (action) {
      case 'calculate':
      case 'calc':
        if (!expression) {
          return { 成功: false, 错误: '缺少必填参数: expression' };
        }
        const calcResult = safeEval(expression);
        if (!calcResult.success) {
          return { 成功: false, 错误: calcResult.error };
        }
        return {
          成功: true,
          数据: {
            expression,
            result: calcResult.result,
            formatted: `${expression} = ${calcResult.result}`
          }
        };

      case 'convert_base':
      case 'base':
        if (value === undefined || !from_base || !to_base) {
          return { 成功: false, 错误: '缺少必填参数: value, from_base, to_base' };
        }
        const baseResult = convertBase(value, from_base, to_base);
        if (!baseResult.success) {
          return { 成功: false, 错误: baseResult.error };
        }
        return {
          成功: true,
          数据: {
            original: { value, base: from_base },
            converted: { value: baseResult.result, base: to_base },
            decimal: baseResult.decimal
          }
        };

      case 'convert_unit':
      case 'unit':
        if (value === undefined || !from || !to) {
          return { 成功: false, 错误: '缺少必填参数: value, from, to' };
        }
        const unitResult = convertUnit(value, from, to);
        if (!unitResult.success) {
          return { 成功: false, 错误: unitResult.error };
        }
        return {
          成功: true,
          数据: {
            original: { value, unit: from },
            converted: { value: unitResult.result, unit: to },
            type: unitResult.type
          }
        };

      case 'solve':
      case 'equation':
        if (!equation) {
          return { 成功: false, 错误: '缺少必填参数: equation' };
        }
        const solveResult = solveEquation(equation);
        if (!solveResult.success) {
          return { 成功: false, 错误: solveResult.error };
        }
        return {
          成功: true,
          数据: {
            equation,
            solution: solveResult.solution,
            x: solveResult.result
          }
        };

      default:
        return { 成功: false, 错误: `未知操作: ${action}` };
    }
  } catch (error) {
    logger.error(`执行失败: ${error.message}`);
    return {
      成功: false,
      错误: error.message
    };
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  name: '计算器',
  description: '计算器技能 - 执行数学运算、进制转换、单位换算、方程求解',

  // 内置技能，不需要拥有权检查
  需要拥有权: false,

  // 能力声明
  abilities: ['计算', '数学运算', '单位换算', '进制转换'],
  
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['calculate', 'calc', 'convert_base', 'base', 'convert_unit', 'unit', 'solve', 'equation'],
        default: 'calculate',
        description: '操作类型：calculate(计算)、base(进制转换)、unit(单位换算)、solve(解方程)'
      },
      expression: {
        type: 'string',
        description: '数学表达式，如 "2+3*4"、"sqrt(16)"、"sin(pi/4)"'
      },
      value: {
        type: 'string',
        description: '要转换的值（用于进制转换或单位换算）'
      },
      from_base: {
        type: 'integer',
        description: '原始进制（2-36）'
      },
      to_base: {
        type: 'integer',
        description: '目标进制（2-36）'
      },
      from: {
        type: 'string',
        description: '原始单位，如 m、kg、c(摄氏度)'
      },
      to: {
        type: 'string',
        description: '目标单位，如 km、lb、f(华氏度)'
      },
      equation: {
        type: 'string',
        description: '方程表达式，如 "2x+3=7"'
      }
    },
    required: []
  },
  
  execute
};
