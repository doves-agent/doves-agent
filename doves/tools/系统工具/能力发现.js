/**
 * @file tools/系统工具/能力发现
 * @description 能力发现工具：查询可用技能和工具能力列表
 * 
 * === 变更三：能力发现模式 ===
 * 按扩展分组展示，支持按扩展名查询。
 * LLM 调用 发现能力 后，处理能力扩展会自动加载对应工具。
 */

import { generateFullCatalog, 获取注册表 } from '../../扩展能力注册表.js';

const text = (content) => ({ content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }] });

let skillIndexRef = null;

export function setSkillIndexRef(skillIndex) {
  skillIndexRef = skillIndex;
}

function getSkillIndexInstance() {
  return skillIndexRef;
}

function getSkillCategoriesForDiscovery() {
  if (skillIndexRef) {
    const categories = skillIndexRef.getCategories();
    if (categories) {
      return Object.entries(categories).map(([name, info]) => ({
        category: name,
        abilities: info.abilities || [],
        count: info.count || 0
      }));
    }
  }
    throw new Error('技能索引未初始化，无法查询能力目录');
}

export async function handleDiscoverCapabilities(args) {
  const query = args.query || '';
  const depth = args.depth || 'summary';

  try {
    const { 工具分类, 工具能力映射 } = await import('../index.js');

    // 扩展级能力目录（来自扩展能力注册表）
    const 扩展目录 = generateFullCatalog();

    if (depth === 'summary') {
      // === 摘要模式：按扩展分组展示 ===
      let 过滤扩展 = 扩展目录;
      if (query) {
        const kw = query.toLowerCase();
        过滤扩展 = 扩展目录.filter(a =>
          a.name.toLowerCase().includes(kw) ||
          a.description.toLowerCase().includes(kw) ||
          a.abilities.some(ab => ab.toLowerCase().includes(kw)) ||
          a.intents.some(i => i.keywords.some(k => k.toLowerCase().includes(kw)))
        );
      }

      return text({
        message: '可用扩展能力目录（使用 depth="detail" 查看具体工具定义）',
        扩展: 过滤扩展.map(a => {
          const item = {
            name: a.name,
            description: a.description,
            abilities: a.abilities,
          };
          // 包含能力组指引与流程案例
          if (a.workflow && a.workflow.能力组.length > 0) {
            item.能力组 = a.workflow.能力组.map(p => ({
              名称: p.名称,
              说明: p.说明,
              工具: p.工具,
            }));
            if (a.workflow.流程案例 && a.workflow.流程案例.length > 0) {
              item.流程案例 = a.workflow.流程案例.map(c => ({
                名称: c.名称,
                适用场景: c.适用场景,
                流程: c.流程,
                快捷技能: c.快捷技能 || null,
              }));
            }
            if (a.workflow.关键规则.length > 0) {
              item.建议规则 = a.workflow.关键规则;
            }
          }
          return item;
        }),
        提示: '流程案例仅供参考，根据用户实际需求灵活组合工具。发现需要的扩展后，下一轮对话将自动加载对应工具'
      });
    } else {
      // === 详细模式：返回匹配扩展的工具定义 ===
      const 全部工具 = (await import('../index.js')).获取所有工具定义();

      let 过滤扩展 = 扩展目录;
      if (query) {
        const kw = query.toLowerCase();
        过滤扩展 = 扩展目录.filter(a =>
          a.name.toLowerCase().includes(kw) ||
          a.description.toLowerCase().includes(kw) ||
          a.abilities.some(ab => ab.toLowerCase().includes(kw)) ||
          a.intents.some(i => i.keywords.some(k => k.toLowerCase().includes(kw)))
        );
      }

      // 获取匹配扩展的工具定义
      const 匹配工具 = 全部工具.filter(t => {
        const 工具能力 = 工具能力映射[t.name] || [];
        const 标准化工具能力 = (Array.isArray(工具能力) ? 工具能力 : []).map(c => c.toLowerCase());
        // 工具的能力标签与扩展的 abilities 有交集
        return 过滤扩展.some(ext =>
          ext.abilities.some(ab =>
            标准化工具能力.includes(ab.toLowerCase()) ||
            t.name.toLowerCase().includes(ab.toLowerCase())
          )
        );
      });

      // 同时按工具分类补充
      const 工具目录行 = [];
      for (const [分类, 工具列表] of Object.entries(工具分类)) {
        if (query) {
          const kw = query.toLowerCase();
          const 匹配 = 工具列表.filter(工具名 => {
            const 能力 = 工具能力映射[工具名] || [];
            return 工具名.toLowerCase().includes(kw) ||
              (Array.isArray(能力) && 能力.some(c => c.toLowerCase().includes(kw)));
          });
          if (匹配.length > 0) {
            工具目录行.push({ 分类, 工具数: 匹配.length, 工具名列表: 匹配 });
          }
        } else {
          工具目录行.push({ 分类, 工具数: 工具列表.length, 工具名列表 });
        }
      }

      return text({
        message: '详细能力列表',
        扩展: 过滤扩展,
        工具分类: 工具目录行,
        匹配工具定义: 匹配工具.map(t => ({ name: t.name, description: t.description })),
        提示: '发现需要的工具后，下一轮对话将自动加载'
      });
    }
  } catch (err) {
    return text({ error: `查询能力目录失败: ${err.message}` });
  }
}
