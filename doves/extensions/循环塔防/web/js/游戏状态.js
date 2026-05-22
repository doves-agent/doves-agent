/**
 * 循环塔防 - 客户端游戏状态管理
 */

export class 游戏状态 {
  constructor() {
    this.重置();
  }

  重置() {
    this.roomId = null;
    this.阶段 = 'lobby'; // lobby | waiting | playing | ended
    this.myPlayerId = null;
    this.玩家数 = 0;
    this.段落 = [];
    this.路径 = [];
    this.tick = 0;
    this.事件日志 = [];
  }

  设置房间(roomId, playerId) {
    this.roomId = roomId;
    this.myPlayerId = playerId;
    this.阶段 = 'waiting';
  }

  初始化游戏(data) {
    const 状态 = data.状态;
    this.阶段 = 'playing';
    this.玩家数 = 状态.玩家数;
    this.段落 = 状态.段落;
    this.路径 = 状态.路径;
    this.tick = 0;
  }

  更新tick(data) {
    this.tick = data.tick;
    this.段落 = data.段落;

    // 记录事件到日志
    if (data.事件) {
      for (const ev of data.事件) {
        this.添加日志(ev);
      }
    }
  }

  添加日志(事件) {
    let text = '';
    let type = '';
    switch (事件.类型) {
      case '单位生成':
        text = `[${事件.来源}] 出兵: ${事件.单位类型}×${事件.数量}`;
        type = 'spawn';
        break;
      case '单位死亡':
        text = `击杀 +$${事件.赏金}`;
        type = 'kill';
        break;
      case '基地受损':
        text = `基地受损 -${事件.伤害}HP (${事件.剩余HP})`;
        type = 'damage';
        break;
      case '玩家淘汰':
        text = `⚠ 玩家淘汰!`;
        type = 'kill';
        break;
      case '塔台开火':
        return; // 太频繁不记录
      default:
        text = JSON.stringify(事件);
    }
    this.事件日志.push({ text, type, tick: this.tick });
    if (this.事件日志.length > 100) this.事件日志.shift();
  }

  获取我的段落() {
    return this.段落.find(s => s.玩家ID === this.myPlayerId);
  }

  获取我的槽位() {
    const 段 = this.获取我的段落();
    return 段 ? this.段落.indexOf(段) : -1;
  }
}
