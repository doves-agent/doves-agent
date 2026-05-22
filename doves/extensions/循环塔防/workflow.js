export default {
  groups: [
    {
      name: '循环塔防',
      abilities: ['创建房间', '加入游戏', '建造塔台', '生产单位', 'AI对战'],
    },
  ],
  flows: [
    '创建房间 → 等待玩家 → 开始游戏 → 建塔/出兵 → 胜负结算',
  ],
};
