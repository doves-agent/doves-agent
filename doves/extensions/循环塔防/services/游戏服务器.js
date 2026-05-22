/**
 * 循环塔防 - WebSocket 游戏服务器
 *
 * 数据流：
 *   CLI Web ──WebSocket──▶ 游戏服务器 (本模块)
 *                         ├── 房间管理器.js
 *                         ├── 游戏引擎.js
 *                         └── AI决策器.js
 */

import { WebSocketServer } from 'ws';
import * as 房间管理 from './房间管理器.js';
import * as 引擎 from './游戏引擎.js';
import { AI决策 } from './AI决策器.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('循环塔防', { 前缀: '[循环塔防]', 级别: 'debug', 显示调用位置: true });

let wss = null;
let cleanerInterval = null;

// 房间→客户端追踪
const roomClients = new Map();

/**
 * 启动 WebSocket 服务器
 */
export async function start(port = 3101) {
  if (wss) {
    logger.warn('已在运行中');
    return wss.address().port;
  }

  return new Promise((resolve, reject) => {
    wss = new WebSocketServer({ port });

    wss.on('listening', () => {
      const actualPort = wss.address().port;
      logger.info(`循环塔防 WebSocket 已启动: ws://localhost:${actualPort}`);
      cleanerInterval = setInterval(() => 房间管理.清理不活跃房间(), 5 * 60 * 1000);
      cleanerInterval.unref();
      resolve(actualPort);
    });

    wss.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`端口 ${port} 被占用，尝试 ${port + 1}`);
        wss = null;
        start(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const nickname = decodeURIComponent(url.searchParams.get('nickname') || '塔防玩家');
      const userId = 'td_' + (url.searchParams.get('uid') || Math.random().toString(36).substr(2, 8));

      ws.userId = userId;
      ws.username = nickname;
      ws.rooms = new Set();
      ws.playerId = null; // 当前房间的playerId

      ws.send(JSON.stringify({ type: 'connected', userId, username: nickname }));

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          处理消息(ws, msg);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: '无效消息格式' }));
        }
      });

      ws.on('close', () => {
        for (const roomId of ws.rooms) {
          处理离开房间(ws, roomId);
        }
      });
    });
  });
}

/**
 * 停止服务器
 */
export async function stop() {
  if (!wss) return;
  if (cleanerInterval) { clearInterval(cleanerInterval); cleanerInterval = null; }

  引擎.停止全部();

  for (const ws of wss.clients) {
    ws.close(1001, '服务器关闭');
  }

  return new Promise((resolve) => {
    wss.close(() => { logger.info('已停止'); wss = null; resolve(); });
  });
}

export function getStatus() {
  return {
    running: !!wss,
    port: wss?.address()?.port || null,
    rooms: 房间管理.列出房间().length,
    connections: wss?.clients?.size || 0,
  };
}

// ==================== 消息路由 ====================

async function 处理消息(ws, message) {
  const { action, data = {}, requestId } = message;
  if (!action) return 回复(ws, requestId, { success: false, error: '缺少 action' });

  try {
    const result = await 执行动作(action, data, ws);
    if (result.reply) 回复(ws, requestId, result.reply, action);
    if (result.broadcasts) {
      for (const bc of result.broadcasts) 广播(bc.roomId, bc.update);
    }
  } catch (e) {
    logger.error(`动作 ${action} 执行失败:`, e.message);
    回复(ws, requestId, { success: false, error: e.message }, action);
  }
}

async function 执行动作(action, data, ws) {
  const { userId, username } = ws;

  switch (action) {
    // ===== 房间管理 =====
    case 'create_room': {
      const room = 房间管理.创建房间(userId, username, {
        模式: data.模式 || 'FFA',
        玩家上限: data.玩家上限 || 2,
        AI填充: data.AI填充 !== false,
        AI难度: data.AI难度 || '普通',
      });
      ws.playerId = room.players[0].playerId;
      加入追踪(room.roomId, ws);
      return { reply: { success: true, room: 脱敏(room), playerId: ws.playerId }, broadcasts: [{ roomId: room.roomId, update: { gameType: 'room_update', data: 脱敏(room) } }] };
    }

    case 'join_room': {
      const result = 房间管理.加入房间(data.roomId, userId, username);
      if (result.error) return { reply: { success: false, error: result.error } };
      ws.playerId = result.player.playerId;
      加入追踪(data.roomId, ws);
      return { reply: { success: true, room: 脱敏(result.room), playerId: ws.playerId }, broadcasts: [{ roomId: data.roomId, update: { gameType: 'room_update', data: 脱敏(result.room) } }] };
    }

    case 'leave_room': {
      return 处理离开房间(ws, data.roomId);
    }

    case 'list_rooms': {
      const rooms = 房间管理.列出房间(data.status);
      return { reply: { success: true, rooms: rooms.map(脱敏) } };
    }

    case 'set_ready': {
      const room = 房间管理.获取房间(data.roomId);
      if (!room) return { reply: { success: false, error: '房间不存在' } };
      const player = room.players.find(p => p.userId === userId);
      if (!player) return { reply: { success: false, error: '不在房间中' } };
      房间管理.设置准备(data.roomId, player.playerId, data.ready);
      return { reply: { success: true }, broadcasts: [{ roomId: data.roomId, update: { gameType: 'room_update', data: 脱敏(room) } }] };
    }

    case 'start_game': {
      const room = 房间管理.获取房间(data.roomId);
      if (!room) return { reply: { success: false, error: '房间不存在' } };
      if (room.hostUserId !== userId) return { reply: { success: false, error: '只有房主可以开始' } };

      房间管理.AI填充(room);
      const 状态 = 引擎.初始化游戏(room);
      room.status = '游戏中';

      // 启动 tick 循环
      引擎.启动游戏循环(
        room.roomId,
        room,
        (update) => 广播(room.roomId, update),
        (玩家ID, 摘要) => 执行AI决策(room, 玩家ID, 摘要),
      );

      return {
        reply: { success: true },
        broadcasts: [{ roomId: room.roomId, update: { gameType: 'game_start', data: { roomId: room.roomId, 状态: 序列化状态(状态) } } }],
      };
    }

    // ===== 游戏指令 =====
    case '建造塔台': {
      const room = 房间管理.获取房间(data.roomId);
      if (!room?.gameState) return { reply: { success: false, error: '游戏未开始' } };
      const player = room.players.find(p => p.userId === userId);
      if (!player) return { reply: { success: false, error: '不在房间中' } };
      const result = 引擎.建造塔台(room.gameState, player.playerId, data.类型, data.位置);
      return { reply: { success: !result.error, ...result } };
    }

    case '升级塔台': {
      const room = 房间管理.获取房间(data.roomId);
      if (!room?.gameState) return { reply: { success: false, error: '游戏未开始' } };
      const player = room.players.find(p => p.userId === userId);
      if (!player) return { reply: { success: false, error: '不在房间中' } };
      const result = 引擎.升级塔台(room.gameState, player.playerId, data.塔台ID);
      return { reply: { success: !result.error, ...result } };
    }

    case '出售塔台': {
      const room = 房间管理.获取房间(data.roomId);
      if (!room?.gameState) return { reply: { success: false, error: '游戏未开始' } };
      const player = room.players.find(p => p.userId === userId);
      if (!player) return { reply: { success: false, error: '不在房间中' } };
      const result = 引擎.出售塔台(room.gameState, player.playerId, data.塔台ID);
      return { reply: { success: !result.error, ...result } };
    }

    case '生产单位': {
      const room = 房间管理.获取房间(data.roomId);
      if (!room?.gameState) return { reply: { success: false, error: '游戏未开始' } };
      const player = room.players.find(p => p.userId === userId);
      if (!player) return { reply: { success: false, error: '不在房间中' } };
      const result = 引擎.生产单位(room.gameState, player.playerId, data.类型, data.数量 || 1);
      return { reply: { success: !result.error, ...result } };
    }

    // ===== 匹配 =====
    case 'enqueue_match': {
      const result = 房间管理.匹配入队(userId, username, data.模式);
      if (result.matched && result.room) {
        加入追踪(result.room.roomId, ws);
        return { reply: { success: true, matched: true, room: 脱敏(result.room) } };
      }
      return { reply: { success: true, matched: false } };
    }

    case 'dequeue_match': {
      房间管理.匹配出队(userId);
      return { reply: { success: true } };
    }

    default:
      return { reply: { success: false, error: `未知动作: ${action}` } };
  }
}

// ===== AI 决策执行 =====

async function 执行AI决策(room, 玩家ID, 摘要) {
  try {
    const 难度 = room.settings?.AI难度 || '普通';
    const 动作列表 = await AI决策(摘要, 难度);
    if (!动作列表 || !room.gameState) return;

    for (const 动作 of 动作列表) {
      switch (动作.动作) {
        case '建造':
          引擎.建造塔台(room.gameState, 玩家ID, 动作.类型, 动作.位置);
          break;
        case '升级':
          引擎.升级塔台(room.gameState, 玩家ID, 动作.塔台ID);
          break;
        case '出售':
          引擎.出售塔台(room.gameState, 玩家ID, 动作.塔台ID);
          break;
        case '生产':
          引擎.生产单位(room.gameState, 玩家ID, 动作.类型, 动作.数量 || 1);
          break;
        case '等待':
          break;
      }
    }
  } catch (e) {
    logger.error(`AI决策执行失败 [${玩家ID}]:`, e.message);
  }
}

// ===== 辅助函数 =====

function 加入追踪(roomId, ws) {
  if (!roomClients.has(roomId)) roomClients.set(roomId, new Set());
  roomClients.get(roomId).add(ws);
  ws.rooms.add(roomId);
}

function 处理离开房间(ws, roomId) {
  const result = 房间管理.离开房间(roomId, ws.userId);
  ws.rooms.delete(roomId);
  const clients = roomClients.get(roomId);
  if (clients) {
    clients.delete(ws);
    if (clients.size === 0) roomClients.delete(roomId);
  }
  if (result.room) 广播(roomId, { gameType: 'room_update', data: 脱敏(result.room) });
  return { reply: { success: true } };
}

function 广播(roomId, update) {
  const msg = JSON.stringify({ type: 'game_update', ...update, timestamp: Date.now() });
  const clients = roomClients.get(roomId);
  if (!clients) return;
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(msg); } catch (e) { /* ignore */ }
    }
  }
}

function 回复(ws, requestId, payload, action) {
  ws.send(JSON.stringify({ type: 'game_response', action, requestId, ...payload }));
}

function 脱敏(room) {
  return {
    roomId: room.roomId,
    模式: room.模式,
    玩家上限: room.玩家上限,
    status: room.status,
    players: room.players.map(p => ({
      playerId: p.playerId,
      username: p.username,
      isAI: p.isAI,
      ready: p.ready,
      slot: p.slot,
    })),
    hostUserId: room.hostUserId,
    settings: room.settings,
  };
}

function 序列化状态(状态) {
  return {
    阶段: 状态.阶段,
    tick: 状态.tick,
    模式: 状态.模式,
    玩家数: 状态.玩家数,
    路径: 状态.路径,
    段落: 状态.段落.map(s => ({
      玩家ID: s.玩家ID,
      用户名: s.用户名,
      isAI: s.isAI,
      槽位: s.槽位,
      存活: s.存活,
      基地HP: s.基地HP,
      最大HP: s.最大HP,
      资源: s.资源,
      收入率: s.收入率,
      塔台: s.塔台,
      单位: [],
    })),
  };
}
