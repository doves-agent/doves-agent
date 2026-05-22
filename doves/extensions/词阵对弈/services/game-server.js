/**
 * 词阵对弈 - 游戏 WebSocket 服务器
 *
 * Doves 扩展自启的独立 WebSocket 服务
 * CLI Web 页面通过 externalUrls 声明直连此服务器
 * Server 不参与游戏通信
 *
 * 数据流：
 *   CLI Web ──WebSocket──▶ game-server (本模块)
 *                         ├── room-manager.js (房间管理)
 *                         └── game-engine.js  (战斗引擎)
 */

import { WebSocketServer } from 'ws';
import * as gameRoom from './room-manager.js';
import * as gameEngine from './game-engine.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('游戏服务器', { 前缀: '[游戏服务器]', 级别: 'debug', 显示调用位置: true });

let wss = null;
let cleanerInterval = null;

// 房间内客户端追踪 Map<roomId, Set<ws>>
const roomClients = new Map();
// 房间回合定时器 Map<roomId, NodeJS.Timeout>
const roundTimers = new Map();

const ROUND_INTERVAL = 8000; // 每8秒一个回合

/**
 * 启动游戏 WebSocket 服务器
 */
export async function start(port = 3100) {
  if (wss) {
    logger.warn('已在运行中，跳过启动');
    return wss.address().port;
  }

  return new Promise((resolve, reject) => {
    wss = new WebSocketServer({ port });

    wss.on('listening', () => {
      const actualPort = wss.address().port;
      logger.info(`词阵对弈 WebSocket 已启动: ws://localhost:${actualPort}`);

      cleanerInterval = setInterval(() => {
        gameRoom.cleanInactiveRooms();
      }, 5 * 60 * 1000);
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
      const nickname = decodeURIComponent(url.searchParams.get('nickname') || '玩家');
      const userId = 'game_' + (url.searchParams.get('uid') || Math.random().toString(36).substr(2, 8));

      ws.userId = userId;
      ws.username = nickname;
      ws.rooms = new Set();

      ws.send(JSON.stringify({
        type: 'connected',
        userId,
        username: nickname,
      }));

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          handleMessage(ws, message);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: '无效的消息格式' }));
        }
      });

      ws.on('close', () => {
        for (const roomId of ws.rooms) {
          handleLeaveRoom(ws, roomId);
        }
      });
    });
  });
}

/**
 * 停止游戏 WebSocket 服务器
 */
export async function stop() {
  if (!wss) return;

  if (cleanerInterval) {
    clearInterval(cleanerInterval);
    cleanerInterval = null;
  }

  // 清理所有回合定时器
  for (const [, timer] of roundTimers) {
    clearInterval(timer);
  }
  roundTimers.clear();

  for (const ws of wss.clients) {
    ws.close(1001, '服务器关闭');
  }

  return new Promise((resolve) => {
    wss.close(() => {
      logger.info('已停止');
      wss = null;
      resolve();
    });
  });
}

/**
 * 获取服务器状态信息
 */
export function getStatus() {
  return {
    running: !!wss,
    port: wss?.address()?.port || null,
    rooms: gameRoom.listRooms().length,
    connections: wss?.clients?.size || 0,
  };
}

// ==================== 消息处理 ====================

async function handleMessage(ws, message) {
  const { action, data = {}, requestId } = message;
  if (!action) {
    return ws.send(JSON.stringify({ type: 'error', requestId, message: '缺少 action' }));
  }

  try {
    const result = await processAction(action, data, ws);

    if (result.reply) {
      ws.send(JSON.stringify({
        type: 'game_response',
        action,
        requestId,
        ...result.reply,
      }));
    }

    if (result.broadcasts) {
      for (const bc of result.broadcasts) {
        broadcastToRoom(bc.roomId, bc.update);
      }
    }
  } catch (e) {
    ws.send(JSON.stringify({
      type: 'error',
      action,
      requestId,
      message: e.message,
    }));
  }
}

async function processAction(action, data, ws) {
  const { userId, username } = ws;

  switch (action) {
    // ===== 房间管理 =====
    case 'create_room': {
      const room = gameRoom.createRoom(userId, username, {
        mode: data.mode || '1v1',
        gameType: data.gameType || 'idiom',
        aiFill: data.aiFill !== false,
        aiDifficulty: data.aiDifficulty || 'medium',
      });
      joinRoomTracking(room.roomId, ws);
      return {
        reply: { success: true, room: sanitizeRoom(room) },
        broadcasts: [{ roomId: room.roomId, update: { gameType: 'room_update', data: sanitizeRoom(room) } }],
      };
    }

    case 'join_room': {
      const result = gameRoom.joinRoom(data.roomId, userId, username);
      if (result.error) return { reply: { success: false, error: result.error } };
      joinRoomTracking(data.roomId, ws);
      return {
        reply: { success: true, room: sanitizeRoom(result.room), player: result.player },
        broadcasts: [{ roomId: data.roomId, update: { gameType: 'room_update', data: sanitizeRoom(result.room) } }],
      };
    }

    case 'leave_room': {
      return handleLeaveRoom(ws, data.roomId);
    }

    case 'list_rooms': {
      const rooms = gameRoom.listRooms(data.status);
      return { reply: { success: true, rooms: rooms.map(sanitizeRoom) } };
    }

    case 'get_room': {
      const room = gameRoom.getRoom(data.roomId);
      if (!room) return { reply: { success: false, error: '房间不存在' } };
      return { reply: { success: true, room: sanitizeRoom(room) } };
    }

    // ===== 匹配系统 =====
    case 'enqueue_match': {
      const result = gameRoom.enqueueMatch(userId, username, data.mode, data.gameType);
      if (result.matched && result.room) {
        joinRoomTracking(result.room.roomId, ws);
        return {
          reply: { success: true, matched: true, room: sanitizeRoom(result.room) },
          broadcasts: [{ roomId: result.room.roomId, update: { gameType: 'match_found', data: { roomId: result.room.roomId, room: sanitizeRoom(result.room) } } }],
        };
      }
      return { reply: { success: true, matched: false } };
    }

    case 'dequeue_match': {
      gameRoom.dequeueMatch(userId);
      return { reply: { success: true } };
    }

    // ===== 准备和开始 =====
    case 'set_ready': {
      const room = gameRoom.getRoom(data.roomId);
      if (!room) return { reply: { success: false, error: '房间不存在' } };
      const player = room.players.find(p => p.userId === userId);
      if (!player) return { reply: { success: false, error: '你不在这个房间' } };
      gameRoom.setReady(data.roomId, player.playerId, data.ready);
      return {
        reply: { success: true },
        broadcasts: [{ roomId: data.roomId, update: { gameType: 'room_update', data: sanitizeRoom(room) } }],
      };
    }

    case 'start_game': {
      const room = gameRoom.getRoom(data.roomId);
      if (!room) return { reply: { success: false, error: '房间不存在' } };
      gameRoom.fillAIPlayers(room);
      gameEngine.initGameState(room);
      room.status = '对弈中';

      // 广播游戏开始
      const broadcasts = [{ roomId: data.roomId, update: {
        gameType: 'game_start',
        data: {
          roomId: room.roomId,
          phase: 'idiom_pick',
          teams: { left: room.teams.left, right: room.teams.right },
          players: sanitizePlayers(room),
        },
      } }];

      // AI 玩家立即选词（在选词阶段之初）
      scheduleAIPick(room, data.roomId);

      return { reply: { success: true }, broadcasts };
    }

    // ===== 选词阶段 =====
    case 'pick_idiom': {
      const room = gameRoom.getRoom(data.roomId);
      if (!room) return { reply: { success: false, error: '房间不存在' } };
      const player = room.players.find(p => p.userId === userId);
      if (!player) return { reply: { success: false, error: '你不在这个房间' } };
      const pickResult = gameEngine.playerPickIdiom(room, player.playerId, data.idiom, data.meaning || '');
      if (pickResult.error) return { reply: { success: false, error: pickResult.error } };

      const broadcasts = [{ roomId: data.roomId, update: { gameType: 'idiom_picked', data: { playerId: player.playerId, pickedCount: pickResult.pickedCount, totalCount: pickResult.totalCount } } }];

      if (pickResult.allPicked) {
        broadcasts.push({ roomId: data.roomId, update: { gameType: 'battle_preparing', data: { roomId: data.roomId, phase: 'battle_prep' } } });
        generateAndStartBattle(room, data.roomId);
      }

      return { reply: { success: true, pickResult }, broadcasts };
    }

    // ===== 战斗阶段 =====
    case 'use_word': {
      const room = gameRoom.getRoom(data.roomId);
      if (!room) return { reply: { success: false, error: '房间不存在' } };
      const player = room.players.find(p => p.userId === userId);
      if (!player) return { reply: { success: false, error: '你不在这个房间' } };
      const result = gameEngine.playerUseWord(room, player.playerId, data.word, data.meaning || '', data.targetId);
      if (result.error) return { reply: { success: false, error: result.error } };

      if (result.win) {
        stopRoundTimer(data.roomId);
        room.status = '已结束';
        return {
          reply: { success: true, result },
          broadcasts: [{ roomId: data.roomId, update: { gameType: 'game_over', data: { winner: result.winner, battleLog: room.gameState.battleLog, players: sanitizePlayers(room) } } }],
        };
      }
      return {
        reply: { success: true, result },
        broadcasts: [{ roomId: data.roomId, update: { gameType: 'battle_action', data: { playerId: player.playerId, word: data.word, targetId: result.targetId, damage: result.damage, targetHp: result.targetHp, playerVocab: result.playerVocab, effectApplied: result.effectApplied } } }],
      };
    }

    default:
      return { reply: { success: false, error: `未知游戏动作: ${action}` } };
  }
}

// ==================== AI 选词（游戏开始后立即执行） ====================

async function scheduleAIPick(room, roomId) {
  const aiPlayers = room.players.filter(p => p.isAI);
  if (aiPlayers.length === 0) return;

  const params = getAIDifficultyParams(room);
  for (const ai of aiPlayers) {
    const delay = params.pickDelay[0] + Math.random() * (params.pickDelay[1] - params.pickDelay[0]);
    setTimeout(() => doAIPick(room, roomId, ai), delay);
  }
}

async function doAIPick(room, roomId, ai) {
  const currentRoom = gameRoom.getRoom(roomId);
  if (!currentRoom || !currentRoom.gameState || currentRoom.gameState.phase !== gameEngine.PHASE.IDIOM_PICK) return;

  let idiom = null;
  let meaning = 'AI自动选择';
  const difficulty = currentRoom.settings?.aiDifficulty || 'medium';
  const strategyMap = { easy: 'defense', medium: 'balanced', hard: 'attack' };

  try {
    const { default: aiPicker } = await import('../tools/_ai_picker.js');
    const result = await aiPicker.选取成语([], [], currentRoom.gameType || 'idiom', strategyMap[difficulty] || 'balanced');
    if (result?.idiom) {
      idiom = result.idiom;
      meaning = result.meaning || meaning;
    }
  } catch (e) {
    logger.debug('AI LLM选词不可用，使用内置词库:', e.message);
  }

  if (!idiom) {
    const fallbackByDifficulty = {
      easy: ['按部就班', '循序渐进', '不温不火', '小试牛刀', '平心静气', '顺其自然', '稳扎稳打', '以静制动'],
      medium: ['势如破竹', '固若金汤', '龙飞凤舞', '行云流水', '出神入化', '雷霆万钧', '铜墙铁壁', '风驰电掣'],
      hard: ['势如破竹', '排山倒海', '雷霆万钧', '摧枯拉朽', '翻天覆地', '万马齐喑', '坚不可摧', '横扫千军'],
    };
    const list = fallbackByDifficulty[difficulty] || fallbackByDifficulty.medium;
    idiom = list[Math.floor(Math.random() * list.length)];
    meaning = 'AI选择';
  }

  const pickResult = gameEngine.playerPickIdiom(currentRoom, ai.playerId, idiom, meaning);
  if (!pickResult || pickResult.error) return;

  broadcastToRoom(roomId, {
    gameType: 'idiom_picked',
    data: { playerId: ai.playerId, pickedCount: pickResult.pickedCount, totalCount: pickResult.totalCount },
  });

  if (pickResult.allPicked) {
    broadcastToRoom(roomId, { gameType: 'battle_preparing', data: { roomId, phase: 'battle_prep' } });
    generateAndStartBattle(currentRoom, roomId);
  }
}

// ==================== 房间追踪 ====================

function joinRoomTracking(roomId, ws) {
  if (!roomClients.has(roomId)) {
    roomClients.set(roomId, new Set());
  }
  roomClients.get(roomId).add(ws);
  ws.rooms.add(roomId);
}

function handleLeaveRoom(ws, roomId) {
  const result = gameRoom.leaveRoom(roomId, ws.userId);
  ws.rooms.delete(roomId);

  const clients = roomClients.get(roomId);
  if (clients) {
    clients.delete(ws);
    if (clients.size === 0) {
      roomClients.delete(roomId);
      stopRoundTimer(roomId);
    }
  }

  if (result.room) {
    broadcastToRoom(roomId, { gameType: 'room_update', data: sanitizeRoom(result.room) });
  }

  return { reply: { success: true } };
}

// ==================== 广播 ====================

function broadcastToRoom(roomId, update) {
  const msg = JSON.stringify({ type: 'game_update', ...update, timestamp: Date.now() });
  const clients = roomClients.get(roomId);
  if (!clients) return;

  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(msg); } catch (e) { logger.debug(`广播消息发送失败: ${e.message}`); }
    }
  }
}

// ==================== 回合定时器 ====================

function startRoundTimer(roomId) {
  if (roundTimers.has(roomId)) return;

  const timer = setInterval(() => {
    const room = gameRoom.getRoom(roomId);
    if (!room || !room.gameState || room.gameState.phase !== gameEngine.PHASE.BATTLE) {
      stopRoundTimer(roomId);
      return;
    }

    const result = gameEngine.updateRound(room);
    if (!result) return;

    if (result.win) {
      stopRoundTimer(roomId);
      room.status = '已结束';
      broadcastToRoom(roomId, {
        gameType: 'game_over',
        data: { winner: result.winner, battleLog: room.gameState.battleLog, players: sanitizePlayers(room) },
      });
      return;
    }

    // 广播回合更新
    broadcastToRoom(roomId, {
      gameType: 'round_update',
      data: {
        round: result.round,
        players: gameEngine.getPlayersSnapshot(room.gameState),
        roundLog: result.roundLog,
      },
    });

    // AI 玩家自动行动
    scheduleAIAction(room, roomId);
  }, ROUND_INTERVAL);

  timer.unref();
  roundTimers.set(roomId, timer);
}

function stopRoundTimer(roomId) {
  const timer = roundTimers.get(roomId);
  if (timer) {
    clearInterval(timer);
    roundTimers.delete(roomId);
  }
}

// ==================== AI 难度参数 ====================

function getAIDifficultyParams(room) {
  const difficulty = room.settings?.aiDifficulty || 'medium';
  switch (difficulty) {
    case 'easy':
      return { specialRate: 0.05, targetStrategy: 'random', actionDelay: [1500, 3000], pickDelay: [2000, 4000] };
    case 'hard':
      return { specialRate: 0.4, targetStrategy: 'smart', actionDelay: [300, 800], pickDelay: [500, 1200] };
    default:
      return { specialRate: 0.2, targetStrategy: 'lowest_hp', actionDelay: [500, 1500], pickDelay: [1000, 2000] };
  }
}

// ==================== AI 战斗行动 ====================

async function scheduleAIAction(room, roomId) {
  const gs = room.gameState;
  if (!gs || gs.phase !== gameEngine.PHASE.BATTLE) return;

  const aiPlayers = Object.values(gs.players).filter(p => p.isAI && p.hp > 0 && !p.frozen);
  const params = getAIDifficultyParams(room);
  for (const ai of aiPlayers) {
    const delay = params.actionDelay[0] + Math.random() * (params.actionDelay[1] - params.actionDelay[0]);
    setTimeout(() => doAIAttack(roomId, ai.playerId), delay);
  }
}

function doAIAttack(roomId, aiPlayerId) {
  const room = gameRoom.getRoom(roomId);
  if (!room || !room.gameState || room.gameState.phase !== gameEngine.PHASE.BATTLE) return;

  const gs = room.gameState;
  const ai = gs.players[aiPlayerId];
  if (!ai || ai.hp <= 0 || ai.frozen) return;

  const params = getAIDifficultyParams(room);

  // 选择目标
  const enemies = Object.values(gs.players).filter(p => p.team !== ai.team && p.hp > 0);
  if (enemies.length === 0) return;

  let target;
  if (params.targetStrategy === 'random') {
    target = enemies[Math.floor(Math.random() * enemies.length)];
  } else if (params.targetStrategy === 'smart') {
    // 优先打攻击力高的（威胁大的）
    enemies.sort((a, b) => b.attack - a.attack);
    target = enemies[0];
  } else {
    enemies.sort((a, b) => a.hp - b.hp);
    target = enemies[0];
  }

  // 选择词语
  let word;
  const useSpecial = Math.random() < params.specialRate && !ai.silenced;
  if (useSpecial) {
    const effectWords = Object.keys(gameEngine.EFFECT_WORD_MAP);
    word = effectWords[Math.floor(Math.random() * effectWords.length)];
  } else {
    const difficulty = room.settings?.aiDifficulty || 'medium';
    if (difficulty === 'easy') {
      const weakWords = ['小试牛刀', '初露锋芒', '循序渐进', '按部就班', '平平无奇', '不温不火'];
      word = weakWords[Math.floor(Math.random() * weakWords.length)];
    } else if (difficulty === 'hard') {
      const strongWords = ['势不可挡', '无坚不摧', '排山倒海', '天崩地裂', '雷霆万钧', '翻天覆地', '摧枯拉朽', '横扫千军'];
      word = strongWords[Math.floor(Math.random() * strongWords.length)];
    } else {
      const attackWords = ['势不可挡', '无坚不摧', '百战百胜', '横扫千军', '锐不可当', '排山倒海', '天崩地裂', '雷霆万钧'];
      word = attackWords[Math.floor(Math.random() * attackWords.length)];
    }
  }

  const vocabCost = word.length * 3;
  if (ai.vocab < vocabCost) return;

  const result = gameEngine.playerUseWord(room, aiPlayerId, word, '', target.playerId);
  if (result.error) return;

  if (result.win) {
    stopRoundTimer(roomId);
    room.status = '已结束';
    broadcastToRoom(roomId, {
      gameType: 'game_over',
      data: { winner: result.winner, battleLog: room.gameState.battleLog, players: sanitizePlayers(room) },
    });
    return;
  }

  broadcastToRoom(roomId, {
    gameType: 'battle_action',
    data: { playerId: aiPlayerId, word, targetId: result.targetId, damage: result.damage, targetHp: result.targetHp, playerVocab: result.playerVocab, effectApplied: result.effectApplied },
  });
}

// ==================== 效果生成 & 战斗启动 ====================

async function generateAndStartBattle(room, roomId) {
  const gs = room.gameState;
  if (!gs) return;

  const teamLeftIdioms = [];
  const teamRightIdioms = [];
  for (const pid of room.teams.left) {
    const ps = gs.players[pid];
    if (ps?.selectedIdioms?.length > 0) {
      teamLeftIdioms.push({ playerId: pid, idiom: ps.selectedIdioms[0].idiom, meaning: ps.selectedIdioms[0].meaning });
    }
  }
  for (const pid of room.teams.right) {
    const ps = gs.players[pid];
    if (ps?.selectedIdioms?.length > 0) {
      teamRightIdioms.push({ playerId: pid, idiom: ps.selectedIdioms[0].idiom, meaning: ps.selectedIdioms[0].meaning });
    }
  }

  let effects;
  try {
    const { default: effGen } = await import('../tools/_effect_generator.js');
    effects = await effGen.生成效果(teamLeftIdioms, teamRightIdioms, room.gameType);
  } catch (e) {
    logger.debug('LLM效果生成不可用，使用内置逻辑:', e.message);
    effects = generateFallbackEffects(teamLeftIdioms, teamRightIdioms);
  }

  gameEngine.startBattle(room, effects);

  broadcastToRoom(roomId, {
    gameType: 'battle_start',
    data: {
      effects: effects?.battleEffects || [],
      battleScene: effects?.battleScene || '古风战场',
      narrative: effects?.narrative || '双方成语碰撞，战斗开始！',
      players: sanitizePlayers(room),
      turnOrder: gs.turnOrder,
    },
  });

  // 启动回合定时器
  startRoundTimer(roomId);
}

function generateFallbackEffects(teamLeft, teamRight) {
  const effects = [];

  for (const p of teamLeft) {
    effects.push({
      team: 'left',
      playerId: p.playerId,
      idiom: p.idiom,
      effect: {
        type: 'attack',
        value: Math.floor(Math.random() * 10) + 8,
        description: `${p.idiom} — 攻势凌厉`,
        animation: 'shake',
      },
    });
  }

  for (const p of teamRight) {
    effects.push({
      team: 'right',
      playerId: p.playerId,
      idiom: p.idiom,
      effect: {
        type: 'attack',
        value: Math.floor(Math.random() * 10) + 8,
        description: `${p.idiom} — 攻势凌厉`,
        animation: 'shake',
      },
    });
  }

  return {
    battleEffects: effects,
    battleScene: '古风战场',
    narrative: '双方成语碰撞，展开激烈对弈！',
  };
}

// ==================== 数据脱敏 ====================

function sanitizeRoom(room) {
  if (!room) return null;
  return {
    roomId: room.roomId,
    mode: room.mode,
    gameType: room.gameType,
    maxPlayers: room.maxPlayers,
    status: room.status,
    players: sanitizePlayers(room),
    teams: room.teams,
    hostPlayerId: room.hostPlayerId,
    hostUserId: room.hostUserId,
    createdAt: room.createdAt,
    settings: room.settings,
  };
}

function sanitizePlayers(room) {
  return room.players.map(p => ({
    playerId: p.playerId,
    username: p.username,
    team: p.team,
    isAI: p.isAI,
    ready: p.ready,
    connected: p.connected,
    ...(room.gameState?.players?.[p.playerId] ? {
      hp: room.gameState.players[p.playerId].hp,
      maxHp: room.gameState.players[p.playerId].maxHp,
      vocab: room.gameState.players[p.playerId].vocab,
      attack: room.gameState.players[p.playerId].attack,
      defense: room.gameState.players[p.playerId].defense,
      speed: room.gameState.players[p.playerId].speed,
      frozen: room.gameState.players[p.playerId].frozen,
      silenced: room.gameState.players[p.playerId].silenced,
      poisoned: room.gameState.players[p.playerId].poisoned,
      idiomPicked: room.gameState.players[p.playerId].idiomPicked,
    } : {}),
  }));
}
