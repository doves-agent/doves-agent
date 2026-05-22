export const extTools = [
  {
    name: 'loop_td_ai_decide',
    description: 'AI玩家根据战局做出塔防决策',
    inputSchema: {
      type: 'object',
      properties: {
        游戏状态摘要: { type: 'string', description: '当前战局状态JSON' },
      },
      required: ['游戏状态摘要'],
    },
  },
];

export const extToolSafetyLevels = {
  loop_td_ai_decide: '安全',
};

export async function handleExtTool(toolName, args) {
  switch (toolName) {
    case 'loop_td_ai_decide': {
      const { AI决策 } = await import('../services/AI决策器.js');
      return await AI决策(JSON.parse(args.游戏状态摘要));
    }
    default:
      throw new Error(`未知工具: ${toolName}`);
  }
}
