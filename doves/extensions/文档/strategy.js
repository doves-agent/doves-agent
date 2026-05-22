/**
 * 文档规划策略
 * 文档管理能力组 + 流程案例
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【文档管理能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. 文档生成工具',
  '   doc_generate：生成文档（API文档/架构文档/README）',
  '   doc_template：管理/应用文档模板',
  '',
  '2. 文档同步工具',
  '   doc_sync_check：检查代码与文档是否同步',
  '   doc_sync_fix：自动同步（代码变更→文档更新）',
  '',
  '3. 语义搜索工具',
  '   doc_search_semantic：语义搜索文档',
  '',
  '4. 代码扫描工具（用于提取文档素材）',
  '   code_read_file：阅读源码，提取API端点/函数签名/类型定义',
  '   code_symbols：提取文件中的符号定义',
  '   code_search：搜索路由定义/接口声明/导出模块',
  '   code_git_diff_detail：了解最近变更',
  '',
  '5. 文档技能',
  '   api_doc 技能：API文档生成',
  '   doc_sync 技能：文档同步',
  '   changelog 技能：变更日志',
  '',
  '【流程案例】（参考，非强制）',
  '- 生成API文档：code_read_file(扫描源码) → doc_generate(生成API文档)',
  '- 文档同步：doc_sync_check(检查同步状态) → doc_sync_fix(修复不同步)',
  '- 变更后更新：code_git_diff_detail(查看变更) → doc_sync_fix(同步更新文档)',
  '- 语义检索：doc_search_semantic(语义搜索) → 整理回答',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 生成文档前先扫描代码提取素材',
  '- 可选将文档摘要存入Git记忆供关键词搜索',
].join('\n');

const 输出格式扩展 = '"docContext": {\n    "docType": "api|architecture|readme|changelog",\n    "sourcePath": "代码目录",\n    "outputFormat": "markdown|html|openapi"\n  },';

const 方法论指引 = '请根据用户实际需求，从文档管理能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。使用 doc_* 工具和 api_doc/doc_sync/changelog 技能。';

export default {
  strategies: {
    document: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        '文档管理',
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
