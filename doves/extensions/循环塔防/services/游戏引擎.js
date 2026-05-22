/**
 * 循环塔防 - 游戏引擎
 * 核心 tick 循环 + 战斗结算
 */

import { 塔台配置, 兵种配置, 升级倍率, 游戏常量 } from '../tools/_配置表.js';
import { 生成地图, 获取行进路径, 计算距离, 验证建造位置 } from './地图生成器.js';
import { 获取额外收入, 获取AI决策间隔 } from './AI决策器.js';

const { TICK_间隔, 起始资源, 被动收入, 击杀赏金倍率, 出售退款率, 基地最大HP, 段落高度, 生产延迟 } = 游戏常量;

let 下一个ID = 1;
function 生成ID() { return `e_${下一个ID++}`; }

// ===== 活跃游戏 Map<roomId, 游戏实例> =====
const 游戏实例表 = new Map();

// ===== 队伍槽位分配 =====

/**
 * 按模式交替分配队伍，确保敌我交替
 * 2v2: A-B-A-B  |  2v2v2: A-B-C-A-B-C  |  4v4: A-B-A-B-A-B-A-B
 */
function 分配队伍槽位(players, 模式) {
  const n = players.length;
  let 队伍数 = 2;
  if (模式 === '2v2v2' || 模式 === '3v3') 队伍数 = 3;

  const 队伍名 = ['红队', '蓝队', '绿队'];
  const 分配 = [];
  for (let i = 0; i < n; i++) {
    分配.push(队伍名[i % 队伍数]);
  }
  return 分配;
}

/**
 * 初始化游戏状态
 */
export function 初始化游戏(room) {
  const 玩家数 = room.players.length;
  const 地图 = 生成地图(玩家数);
  const 路径 = 获取行进路径();

  // 团队模式：分配队伍
  const 是团队模式 = room.模式 && room.模式 !== 'FFA';
  const 队伍分配 = 是团队模式 ? 分配队伍槽位(room.players, room.模式) : null;

  const 状态 = {
    阶段: 'playing',
    tick: 0,
    模式: room.模式 || room.mode || 'FFA',
    队伍: 队伍分配,
    玩家数,
    路径,
    段落: room.players.map((p, i) => ({
      玩家ID: p.playerId,
      用户名: p.username,
      isAI: p.isAI || false,
      槽位: i,
      队伍: 队伍分配 ? 队伍分配[i] : null,
      存活: true,
      基地HP: 基地最大HP,
      最大HP: 基地最大HP,
      资源: 起始资源,
      收入率: 被动收入,
      塔台: [],
      单位: [],
    })),
    生产队列: [],
    淘汰顺序: [],
    事件缓冲: [],
    统计: room.players.map(() => ({ 击杀数: 0, 造成伤害: 0, 出兵数: 0, 建塔数: 0 })),
  };

  room.gameState = 状态;
  return 状态;
}

/**
 * 启动 tick 循环
 */
export function 启动游戏循环(roomId, room, 广播函数, AI回调) {
  const AI难度 = room.settings?.AI难度 || '普通';
  const interval = setInterval(() => {
    if (!room.gameState || room.gameState.阶段 !== 'playing') {
      clearInterval(interval);
      游戏实例表.delete(roomId);
      return;
    }
    执行tick(room.gameState, 广播函数, AI回调, AI难度);
  }, TICK_间隔);
  interval.unref();

  游戏实例表.set(roomId, { interval, room });
}

/**
 * 停止游戏循环
 */
export function 停止游戏循环(roomId) {
  const 实例 = 游戏实例表.get(roomId);
  if (实例) {
    clearInterval(实例.interval);
    游戏实例表.delete(roomId);
  }
}

/**
 * 停止所有游戏循环
 */
export function 停止全部() {
  for (const [roomId, 实例] of 游戏实例表) {
    clearInterval(实例.interval);
  }
  游戏实例表.clear();
}

// ===== 核心 Tick 执行 =====

function 执行tick(状态, 广播, AI回调, AI难度) {
  状态.tick++;
  状态.事件缓冲 = [];

  // 1. 处理生产队列
  处理生产队列(状态);

  // 2. 单位移动
  单位移动(状态);

  // 3. 塔台开火
  塔台开火(状态);

  // 4. 死亡清除 + 赏金
  死亡清除(状态);

  // 5. 穿透基地伤害
  穿透伤害(状态);

  // 6. 被动收入
  被动收入结算(状态, AI难度);

  // 7. 单位特殊效果（回血等）
  单位特殊效果(状态);

  // 8. 胜负检查
  const 结果 = 胜负检查(状态);

  // 9. 广播 delta
  广播({
    gameType: 'tick_update',
    data: {
      tick: 状态.tick,
      段落: 状态.段落.map(s => ({
        玩家ID: s.玩家ID,
        用户名: s.用户名,
        isAI: s.isAI,
        存活: s.存活,
        基地HP: s.基地HP,
        最大HP: s.最大HP,
        资源: s.资源,
        塔台: s.塔台,
        单位: s.单位.map(u => ({ id: u.id, 类型: u.类型, HP: u.HP, 最大HP: u.最大HP, 位置: u.位置, 所属玩家: u.所属玩家, 减速: u.减速 })),
      })),
      事件: 状态.事件缓冲,
    },
  });

  // 10. 游戏结束
  if (结果) {
    状态.阶段 = 'ended';
    广播({
      gameType: 'game_over',
      data: 结果,
    });
    return;
  }

  // 11. AI 决策触发
  const AI间隔 = 获取AI决策间隔(AI难度);
  if (状态.tick % AI间隔 === 0 && AI回调) {
    const AI段落 = 状态.段落.filter(s => s.isAI && s.存活);
    for (const 段 of AI段落) {
      AI回调(段.玩家ID, 构建AI摘要(状态, 段));
    }
  }
}

// ===== 生产队列 =====

function 处理生产队列(状态) {
  const 完成 = [];
  for (let i = 状态.生产队列.length - 1; i >= 0; i--) {
    const 项 = 状态.生产队列[i];
    项.剩余延迟--;
    if (项.剩余延迟 <= 0) {
      投放单位(状态, 项);
      状态.生产队列.splice(i, 1);
    }
  }
}

function 投放单位(状态, 生产项) {
  const { 玩家ID, 单位类型 } = 生产项;
  const 配置 = 兵种配置[单位类型];
  if (!配置) return;

  // 找到该玩家的下家段落（跳过队友和已淘汰的）
  const 源段落 = 状态.段落.find(s => s.玩家ID === 玩家ID);
  if (!源段落 || !源段落.存活) return;

  // 环形寻找下一个有效目标
  let 实际目标 = null;
  for (let offset = 1; offset < 状态.玩家数; offset++) {
    const 候选槽位 = (源段落.槽位 + offset) % 状态.玩家数;
    const 候选 = 状态.段落[候选槽位];
    if (!候选.存活) continue;
    // 团队模式跳过队友
    if (状态.队伍 && 候选.队伍 === 源段落.队伍) continue;
    实际目标 = 候选;
    break;
  }
  if (!实际目标) return;

  const 数量 = 配置.数量 || 1;
  for (let i = 0; i < 数量; i++) {
    实际目标.单位.push({
      id: 生成ID(),
      类型: 单位类型,
      HP: 配置.HP,
      最大HP: 配置.HP,
      速度: 配置.速度,
      护甲: 配置.护甲 || 0,
      位置: { 行: 0, 列: 状态.路径[0].列 + i - Math.floor(数量 / 2) },
      所属玩家: 玩家ID,
      移动累积: 0,
      减速: 0,
      减速剩余: 0,
    });
  }

  状态.事件缓冲.push({ 类型: '单位生成', 段落: 实际目标.槽位, 单位类型, 数量, 来源: 玩家ID });
}

// ===== 单位移动 =====

function 单位移动(状态) {
  for (const 段 of 状态.段落) {
    for (const 单位 of 段.单位) {
      const 实际速度 = 单位.速度 * (1 - 单位.减速);
      单位.移动累积 += 实际速度;

      while (单位.移动累积 >= 1) {
        单位.位置.行 += 1;
        单位.移动累积 -= 1;
      }

      // 减速衰减
      if (单位.减速剩余 > 0) {
        单位.减速剩余--;
        if (单位.减速剩余 <= 0) 单位.减速 = 0;
      }
    }
  }
}

// ===== 塔台开火 =====

function 塔台开火(状态) {
  for (const 段 of 状态.段落) {
    if (!段.存活) continue;

    for (const 塔 of 段.塔台) {
      if (塔.当前冷却 > 0) {
        塔.当前冷却--;
        continue;
      }

      const 配置 = 塔台配置[塔.类型];
      if (!配置) continue;

      const 射程 = 配置.射程 * 升级倍率.属性[塔.等级 - 1];
      const 伤害 = 配置.伤害 * 升级倍率.属性[塔.等级 - 1];

      // 寻找射程内最靠近出口的单位
      const 目标列表 = 段.单位
        .filter(u => u.HP > 0 && 计算距离(塔.位置, u.位置) <= 射程)
        .sort((a, b) => b.位置.行 - a.位置.行); // 越靠近出口优先

      if (目标列表.length === 0) continue;

      if (配置.特殊?.类型 === '范围') {
        // 范围伤害：对主目标附近所有单位造成伤害
        const 主目标 = 目标列表[0];
        for (const u of 段.单位) {
          if (u.HP > 0 && 计算距离(主目标.位置, u.位置) <= 配置.特殊.半径) {
            造成伤害(u, 伤害);
          }
        }
        状态.事件缓冲.push({ 类型: '塔台开火', 段落: 段.槽位, 塔台: 塔.id, 目标: 主目标.id, 范围: true });
      } else {
        // 单体伤害
        const 目标 = 目标列表[0];
        造成伤害(目标, 伤害);

        // 冰塔减速
        if (配置.特殊?.类型 === '减速') {
          目标.减速 = Math.min(0.8, Math.max(目标.减速, 配置.特殊.强度));
          目标.减速剩余 = 配置.特殊.持续;
        }

        状态.事件缓冲.push({ 类型: '塔台开火', 段落: 段.槽位, 塔台: 塔.id, 目标: 目标.id });
      }

      塔.当前冷却 = 配置.冷却;
    }
  }
}

function 造成伤害(单位, 原始伤害) {
  const 实际伤害 = Math.max(1, Math.round(原始伤害 * (100 / (100 + 单位.护甲))));
  单位.HP -= 实际伤害;
}

// ===== 死亡清除 =====

function 死亡清除(状态) {
  for (const 段 of 状态.段落) {
    for (let i = 段.单位.length - 1; i >= 0; i--) {
      const 单位 = 段.单位[i];
      if (单位.HP <= 0) {
        const 配置 = 兵种配置[单位.类型];
        const 赏金 = Math.round((配置?.费用 || 0) * 击杀赏金倍率);
        段.资源 += 赏金;
        状态.事件缓冲.push({ 类型: '单位死亡', 段落: 段.槽位, 单位ID: 单位.id, 赏金 });
        段.单位.splice(i, 1);
      }
    }
  }
}

// ===== 穿透伤害 =====

function 穿透伤害(状态) {
  for (const 段 of 状态.段落) {
    if (!段.存活) continue;

    for (let i = 段.单位.length - 1; i >= 0; i--) {
      const 单位 = 段.单位[i];
      if (单位.位置.行 >= 段落高度) {
        // 到达出口，伤害基地
        const 伤害 = Math.ceil(单位.HP / 10); // 伤害 = 剩余HP/10
        段.基地HP -= 伤害;
        状态.事件缓冲.push({ 类型: '基地受损', 段落: 段.槽位, 伤害, 来源: 单位.所属玩家, 剩余HP: 段.基地HP });
        段.单位.splice(i, 1);
      }
    }
  }
}

// ===== 被动收入 =====

function 被动收入结算(状态, AI难度) {
  const 额外 = 获取额外收入(AI难度);
  for (const 段 of 状态.段落) {
    if (!段.存活) continue;
    段.资源 += 段.收入率;
    if (段.isAI && 额外 > 0) 段.资源 += 额外;
  }
}

// ===== 单位特殊效果 =====

function 单位特殊效果(状态) {
  for (const 段 of 状态.段落) {
    for (const 单位 of 段.单位) {
      const 配置 = 兵种配置[单位.类型];
      if (配置?.特殊?.类型 === '回血' && 单位.HP < 单位.最大HP) {
        单位.HP = Math.min(单位.最大HP, 单位.HP + 配置.特殊.强度);
      }
    }
  }
}

// ===== 胜负检查 =====

function 胜负检查(状态) {
  for (const 段 of 状态.段落) {
    if (段.存活 && 段.基地HP <= 0) {
      段.存活 = false;
      段.单位 = [];
      段.塔台 = [];
      状态.淘汰顺序.push(段.玩家ID);
      状态.事件缓冲.push({ 类型: '玩家淘汰', 段落: 段.槽位, 玩家ID: 段.玩家ID });

      // 团队模式：淘汰队友的资源均分给存活队友
      if (状态.队伍) {
        const 队伍 = 获取玩家队伍(状态, 段.玩家ID);
        if (队伍) {
          const 存活队友 = 状态.段落.filter(s => s.存活 && s.队伍 === 段.队伍 && s.玩家ID !== 段.玩家ID);
          if (存活队友.length > 0) {
            const 均分 = Math.floor(段.资源 / 存活队友.length);
            for (const 友 of 存活队友) {
              友.资源 += 均分;
            }
            状态.事件缓冲.push({ 类型: '资源继承', 段落: 段.槽位, 均分, 受益人数: 存活队友.length });
          }
        }
      }
    }
  }

  // 团队模式胜负判定
  if (状态.队伍) {
    return 团队胜负检查(状态);
  }

  // FFA 模式胜负
  const 存活 = 状态.段落.filter(s => s.存活);
  if (存活.length <= 1) {
    const 胜者 = 存活[0]?.玩家ID || null;
    return { 胜者, 胜利队伍: null, 淘汰顺序: 状态.淘汰顺序, tick数: 状态.tick };
  }
  return null;
}

function 团队胜负检查(状态) {
  const 队伍存活 = {};
  for (const 段 of 状态.段落) {
    if (!段.队伍) continue;
    if (!队伍存活[段.队伍]) 队伍存活[段.队伍] = { 存活: 0, 总数: 0, 成员: [] };
    队伍存活[段.队伍].总数++;
    if (段.存活) {
      队伍存活[段.队伍].存活++;
      队伍存活[段.队伍].成员.push(段.玩家ID);
    }
  }

  const 存活队伍列表 = Object.entries(队伍存活).filter(([_, v]) => v.存活 > 0);
  if (存活队伍列表.length <= 1) {
    const [胜利队伍名, 胜利队伍] = 存活队伍列表[0] || [null, null];
    return {
      胜者: 胜利队伍?.成员[0] || null,
      胜利队伍: 胜利队伍名,
      队伍成员: 胜利队伍?.成员 || [],
      淘汰顺序: 状态.淘汰顺序,
      tick数: 状态.tick,
    };
  }
  return null;
}

function 获取玩家队伍(状态, 玩家ID) {
  const 段 = 状态.段落.find(s => s.玩家ID === 玩家ID);
  return 段?.队伍 || null;
}

// ===== 玩家指令 =====

/**
 * 建造塔台
 */
export function 建造塔台(状态, 玩家ID, 类型, 位置) {
  const 段 = 状态.段落.find(s => s.玩家ID === 玩家ID);
  if (!段 || !段.存活) return { error: '段落无效' };

  const 配置 = 塔台配置[类型];
  if (!配置) return { error: `未知塔台类型: ${类型}` };

  if (段.资源 < 配置.费用) return { error: '资源不足' };
  if (!验证建造位置(段, 位置)) return { error: '位置不可建造' };

  段.资源 -= 配置.费用;
  const 塔 = {
    id: 生成ID(),
    类型,
    等级: 1,
    位置: { ...位置 },
    当前冷却: 0,
  };
  段.塔台.push(塔);
  return { success: true, 塔台: 塔 };
}

/**
 * 升级塔台
 */
export function 升级塔台(状态, 玩家ID, 塔台ID) {
  const 段 = 状态.段落.find(s => s.玩家ID === 玩家ID);
  if (!段 || !段.存活) return { error: '段落无效' };

  const 塔 = 段.塔台.find(t => t.id === 塔台ID);
  if (!塔) return { error: '塔台不存在' };
  if (塔.等级 >= 3) return { error: '已满级' };

  const 配置 = 塔台配置[塔.类型];
  const 升级费用 = Math.round(配置.费用 * 升级倍率.费用[塔.等级]);
  if (段.资源 < 升级费用) return { error: '资源不足' };

  段.资源 -= 升级费用;
  塔.等级++;
  return { success: true, 塔台: 塔 };
}

/**
 * 出售塔台
 */
export function 出售塔台(状态, 玩家ID, 塔台ID) {
  const 段 = 状态.段落.find(s => s.玩家ID === 玩家ID);
  if (!段 || !段.存活) return { error: '段落无效' };

  const 索引 = 段.塔台.findIndex(t => t.id === 塔台ID);
  if (索引 === -1) return { error: '塔台不存在' };

  const 塔 = 段.塔台[索引];
  const 配置 = 塔台配置[塔.类型];
  const 退款 = Math.round(配置.费用 * 出售退款率);
  段.资源 += 退款;
  段.塔台.splice(索引, 1);
  return { success: true, 退款 };
}

/**
 * 生产单位
 */
export function 生产单位(状态, 玩家ID, 单位类型, 数量 = 1) {
  const 段 = 状态.段落.find(s => s.玩家ID === 玩家ID);
  if (!段 || !段.存活) return { error: '段落无效' };

  const 配置 = 兵种配置[单位类型];
  if (!配置) return { error: `未知兵种: ${单位类型}` };

  const 单价 = 配置.费用;
  const 总费用 = 单价 * 数量;
  if (段.资源 < 总费用) return { error: '资源不足' };

  段.资源 -= 总费用;

  for (let i = 0; i < 数量; i++) {
    状态.生产队列.push({
      玩家ID,
      单位类型,
      剩余延迟: 生产延迟 + i, // 每只间隔1tick出现
    });
  }

  return { success: true, 数量, 费用: 总费用 };
}

// ===== AI 状态摘要 =====

function 构建AI摘要(状态, 段) {
  const 下家槽位 = (段.槽位 + 1) % 状态.玩家数;
  const 上家槽位 = (段.槽位 - 1 + 状态.玩家数) % 状态.玩家数;
  const 下家 = 状态.段落[下家槽位];
  const 上家 = 状态.段落[上家槽位];

  return {
    我的状态: {
      基地HP: 段.基地HP,
      资源: 段.资源,
      塔台数: 段.塔台.length,
      塔台: 段.塔台.map(t => `${t.类型}Lv${t.等级}@(${t.位置.行},${t.位置.列})`),
      来袭敌军: 段.单位.length,
      来袭详情: 统计单位(段.单位),
    },
    攻击目标: {
      目标玩家: 下家.用户名,
      目标存活: 下家.存活,
      目标基地HP: 下家.基地HP,
      目标塔台数: 下家.塔台.length,
    },
    威胁来源: {
      来源玩家: 上家.用户名,
      来源存活: 上家.存活,
      来源资源: 上家.资源,
    },
    全局: {
      存活玩家数: 状态.段落.filter(s => s.存活).length,
      当前tick: 状态.tick,
    },
    可用塔位数: 游戏常量.塔台槽列.length * (段落高度 - 2) - 段.塔台.length,
  };
}

function 统计单位(单位列表) {
  const 统计 = {};
  for (const u of 单位列表) {
    统计[u.类型] = (统计[u.类型] || 0) + 1;
  }
  return 统计;
}
