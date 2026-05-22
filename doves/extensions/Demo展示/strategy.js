/**
 * Demo展示规划策略
 * Demo展示能力组 + 流程案例
 */
import { 生成策略提示词, 生成用户提示词 } from '../../prompts/strategy-base.js';

const 方法论段落 = [
  '【Demo展示能力组】',
  '',
  '本扩展提供以下原子工具，可独立调用、自由组合：',
  '',
  '1. Demo创建工具',
  '   demo_create：生成Demo页面（HTML/CSS/JS），自动托管到OSS',
  '   demo_from_data：从数据生成图表/表格Demo',
  '   demo_update：更新已有Demo内容',
  '',
  '2. 模板管理工具',
  '   demo_template_list：列出可用Demo模板',
  '   demo_template 技能：模板管理（选择/扩展/覆盖）',
  '',
  '3. 分享工具',
  '   demo_share：生成分享链接/二维码',
  '',
  '4. 页面生成技能',
  '   page_builder 技能：完整页面生成能力',
  '',
  '【流程案例】（参考，非强制）',
  '- 快速创建Demo：demo_template_list(选模板) → demo_create(生成) → demo_share(分享)',
  '- 数据可视化Demo：demo_from_data(数据→图表) → demo_share(分享)',
  '- 定制化Demo：demo_create(自定义生成) → demo_update(迭代调整)',
  '- 迭代更新：demo_update(修改内容) → demo_share(更新分享)',
  '',
  '【关键规则】',
  '- 根据用户实际需求灵活组合工具，流程案例仅为参考',
  '- 页面应完整自包含（内联CSS/JS），支持CDN引用',
  '- 可检查项目配置中的Demo配置（默认技术栈、主题）',
].join('\n');

const 输出格式扩展 = '"demoContext": {\n    "demoType": "product|dashboard|api_debug|form|mobile|custom",\n    "templateId": "模板ID",\n    "techStack": "html|react|vue"\n  },';

const 方法论指引 = '请根据用户实际需求，从Demo展示能力组中选择合适的工具组合。流程案例仅供参考，不必拘泥于固定流程。使用 demo_* 工具和 page_builder/demo_template 技能。';

export default {
  strategies: {
    demo_showcase: {
      系统: (最大子任务数 = 10, 当前深度 = 0) => 生成策略提示词(
        'Demo展示',
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
