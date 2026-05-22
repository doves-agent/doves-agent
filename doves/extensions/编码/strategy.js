/**
 * 编码规划策略
 * 扩展 = 能力组 + 流程案例
 *
 * 描述可用工具能力 + 提供流程案例参考
 * LLM 根据用户实际请求自行决策工具组合
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【编码能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 代码阅读工具',
  '   code_read_file：读取文件内容',
  '   code_document_symbols：LSP 提取文件符号（函数/类/接口）',
  '   code_goto_definition：跳转到定义',
  '   code_find_references：查找所有引用',
  '   code_hover_info：获取类型签名和文档',
  '   code_semantic_search：语义级代码搜索',
  '   code_list_dir / 目录列表：了解目录结构',
  '',
  '2. 代码修改工具',
  '   code_edit：精准搜索替换（禁止用文件写入覆盖整个文件）',
  '   code_create_file：创建新文件',
  '',
  '3. 验证工具',
  '   code_check_problems：LSP 诊断语法/编译错误',
  '   code_terminal_run：运行命令（测试/构建）',
  '   code_terminal_output：获取运行结果',
  '',
  '4. 高级工具',
  '   code_find_implementations：查找接口实现',
  '   code_call_hierarchy：分析调用链',
  '',
  '【流程案例】（参考，非强制）',
  '- 新增功能：code_read_file(理解代码) → code_edit(修改) → code_check_problems(验证)',
  '- 修Bug：code_read_file(定位) → code_edit(修复) → code_terminal_run(测试)',
  '- 代码阅读：code_document_symbols → code_read_file / code_goto_definition / code_find_references',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 修改前先理解代码逻辑（code_read_file / code_document_symbols）',
  '- 用代码编辑（code_edit）而非文件写入（file_write），只改必要的行',
  '- 编辑后验证（code_check_problems）',
  '- 禁止用执行命令做代码读写、搜索文件、git操作',
].join('\n');

const 输出格式扩展 = '"codeContext": {\n    "targetFiles": ["要修改的文件路径列表"],\n    "changeType": "feature|bugfix|refactor|config",\n    "testStrategy": "unit|integration|manual|none"\n  },';

const 方法论指引 = '请根据用户实际需求，从编码能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。';

export default {
  strategies: {
    coding: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        '编码任务',
        方法论段落,
        输出格式扩展,
        最大子任务数,
        当前深度
      ),

      用户: (任务描述, 能力列表, 可用技能 = []) => 生成用户提示词(
        任务描述,
        能力列表,
        可用技能,
        方法论指引
      ),
    },
  },
};
