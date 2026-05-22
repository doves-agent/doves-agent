/**
 * 循环塔防 - 房间管理器
 * 房间生命周期：创建/加入/离开/匹配/AI填充
 */

import { 游戏常量 } from '../tools/_配置表.js';

const { 最大玩家数 } = 游戏常量;

// 内存房间存储
const 房间表 = new Map();
const 匹配队列 = new Map(); // mode → [{ userId, username, joinedAt }]

let 房间计数 = 0;
function 生成房间ID() { return `room_${++房间计数}_${Date.now().toString(36)}`; }
function 生成玩家ID() { return `p_${Math.random().toString(36).substr(2, 8)}`; }

/**
 * 创建房间
 */
export function 创建房间(userId, username, options = {}) {
  const { 模式 = 'FFA', 玩家上限 = 2, AI填充 = true, AI难度 = '普通' } = options;

  // 团队模式自动调整人数为偶数
  let 实际上限 = Math.min(玩家上限, 最大玩家数);
  if (模式 === '2v2') 实际上限 = 4;
  else if (模式 === '2v2v2') 实际上限 = 6;
  else if (模式 === '4v4') 实际上限 = 8;

  const playerId = 生成玩家ID();
  const room = {
    roomId: 生成房间ID(),
    模式,
    玩家上限: 实际上限,
    status: '等待中',
    players: [{
      playerId,
      userId,
      username,
      isAI: false,
      team: null,
      ready: false,
      connected: true,
      slot: 0,
    }],
    hostPlayerId: playerId,
    hostUserId: userId,
    settings: { AI填充, AI难度 },
    gameState: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  房间表.set(room.roomId, room);
  return room;
}

/**
 * 加入房间
 */
export function 加入房间(roomId, userId, username) {
  const room = 房间表.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (room.status !== '等待中') return { error: '游戏已开始' };
  if (room.players.length >= room.玩家上限) return { error: '房间已满' };
  if (room.players.find(p => p.userId === userId)) return { error: '已在房间中' };

  const playerId = 生成玩家ID();
  const player = {
    playerId,
    userId,
    username,
    isAI: false,
    team: null,
    ready: false,
    connected: true,
    slot: room.players.length,
  };

  room.players.push(player);
  room.updatedAt = Date.now();
  return { room, player };
}

/**
 * 离开房间
 */
export function 离开房间(roomId, userId) {
  const room = 房间表.get(roomId);
  if (!room) return {};

  const index = room.players.findIndex(p => p.userId === userId);
  if (index === -1) return {};

  room.players.splice(index, 1);
  room.updatedAt = Date.now();

  // 重新分配槽位
  room.players.forEach((p, i) => { p.slot = i; });

  // 房间空了就删除
  if (room.players.filter(p => !p.isAI).length === 0) {
    房间表.delete(roomId);
    return { deleted: true };
  }

  // 房主离开，转移
  if (room.hostUserId === userId && room.players.length > 0) {
    const 新房主 = room.players.find(p => !p.isAI);
    if (新房主) {
      room.hostPlayerId = 新房主.playerId;
      room.hostUserId = 新房主.userId;
    }
  }

  return { room };
}

/**
 * 获取房间
 */
export function 获取房间(roomId) {
  return 房间表.get(roomId) || null;
}

/**
 * 列出房间
 */
export function 列出房间(status) {
  const rooms = [...房间表.values()];
  if (status) return rooms.filter(r => r.status === status);
  return rooms.filter(r => r.status !== '已结束');
}

/**
 * 设置准备状态
 */
export function 设置准备(roomId, playerId, ready) {
  const room = 房间表.get(roomId);
  if (!room) return;
  const player = room.players.find(p => p.playerId === playerId);
  if (player) player.ready = ready;
}

/**
 * AI 填充空位
 */
export function AI填充(room) {
  if (!room.settings.AI填充) return;
  const AI名 = ['铁壁卫士', '闪电突击', '蚁群战术', '精英猎手', '冰霜法师', '炮火先锋', '暗影刺客', '天雷裁决'];
  let aiIndex = 0;

  while (room.players.length < room.玩家上限) {
    const name = AI名[aiIndex % AI名.length];
    room.players.push({
      playerId: 生成玩家ID(),
      userId: `ai_${Date.now()}_${aiIndex}`,
      username: `[AI] ${name}`,
      isAI: true,
      team: null,
      ready: true,
      connected: true,
      slot: room.players.length,
    });
    aiIndex++;
  }
}

/**
 * 匹配入队
 */
export function 匹配入队(userId, username, 模式 = 'FFA') {
  if (!匹配队列.has(模式)) 匹配队列.set(模式, []);
  const queue = 匹配队列.get(模式);

  // 避免重复
  if (queue.find(q => q.userId === userId)) return { matched: false };

  queue.push({ userId, username, joinedAt: Date.now() });

  // 检查是否凑齐（FFA默认2人即可开）
  const 需要人数 = 模式 === 'FFA' ? 2 : (模式 === '2v2' ? 4 : 2);
  if (queue.length >= 需要人数) {
    const 匹配玩家 = queue.splice(0, 需要人数);
    const room = 创建房间(匹配玩家[0].userId, 匹配玩家[0].username, { 模式, 玩家上限: 需要人数 });
    for (let i = 1; i < 匹配玩家.length; i++) {
      加入房间(room.roomId, 匹配玩家[i].userId, 匹配玩家[i].username);
    }
    return { matched: true, room };
  }

  return { matched: false };
}

/**
 * 匹配出队
 */
export function 匹配出队(userId) {
  for (const [模式, queue] of 匹配队列) {
    const index = queue.findIndex(q => q.userId === userId);
    if (index !== -1) queue.splice(index, 1);
  }
}

/**
 * 清理不活跃房间（5分钟无更新且等待中的）
 */
export function 清理不活跃房间() {
  const 超时 = 5 * 60 * 1000;
  const now = Date.now();
  for (const [roomId, room] of 房间表) {
    if (room.status === '等待中' && now - room.updatedAt > 超时) {
      房间表.delete(roomId);
    }
    if (room.status === '已结束' && now - room.updatedAt > 超时) {
      房间表.delete(roomId);
    }
  }
}
