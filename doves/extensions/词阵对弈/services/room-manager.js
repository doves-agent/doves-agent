/**
 * 词阵对弈 - 房间管理器
 * 管理游戏房间的创建、加入、匹配、生命周期
 */

// 房间存储 Map<roomId, Room>
const rooms = new Map();
// 匹配队列
const matchQueue = [];

// 房间ID生成
let roomCounter = Date.now();

function generateRoomId() {
  return 'room_' + (roomCounter++).toString(36) + Math.random().toString(36).substr(2, 4);
}

function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substr(2, 8);
}

/**
 * 创建房间
 */
export function createRoom(hostUserId, hostUsername, options = {}) {
  const roomId = generateRoomId();
  const mode = options.mode || '1v1';
  const gameType = options.gameType || 'idiom';
  const maxPlayers = mode === '1v1' ? 2 : mode === '2v2' ? 4 : 8;

  const room = {
    roomId,
    mode,
    gameType,
    maxPlayers,
    status: '等待中', // 等待中 | 对弈中 | 已结束
    players: [],
    teams: { left: [], right: [] },
    hostUserId,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    gameState: null, // 由game-engine填充
    settings: {
      aiFill: options.aiFill !== false, // 默认开启AI填充
      aiDifficulty: options.aiDifficulty || 'medium',
      roundTimeout: 30000, // 30秒超时
    },
  };

  // 添加房主
  const player = {
    playerId: generatePlayerId(),
    userId: hostUserId,
    username: hostUsername || hostUserId,
    isAI: false,
    team: null, // 进入后分配
    ready: false,
    connected: true,
    joinedAt: Date.now(),
  };
  room.players.push(player);
  room.hostPlayerId = player.playerId;

  rooms.set(roomId, room);
  return room;
}

/**
 * 加入房间
 */
export function joinRoom(roomId, userId, username) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };
  if (room.status !== '等待中') return { error: '游戏已开始，无法加入' };
  if (room.players.length >= room.maxPlayers) return { error: '房间已满' };

  // 检查是否已在房间中
  const existing = room.players.find(p => p.userId === userId);
  if (existing) return { error: '你已经在房间中了' };

  const player = {
    playerId: generatePlayerId(),
    userId,
    username: username || userId,
    isAI: false,
    team: null,
    ready: false,
    connected: true,
    joinedAt: Date.now(),
  };

  room.players.push(player);
  room.lastActivity = Date.now();

  // 自动分配队伍
  autoAssignTeams(room);

  return { room, player };
}

/**
 * 离开房间
 */
export function leaveRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const idx = room.players.findIndex(p => p.userId === userId);
  if (idx === -1) return { error: '你不在这个房间中' };

  const player = room.players[idx];
  room.players.splice(idx, 1);

  // 如果是房主离开，转移房主
  if (player.playerId === room.hostPlayerId && room.players.length > 0) {
    room.hostPlayerId = room.players[0].playerId;
  }

  room.lastActivity = Date.now();

  // 如果房间没人了，删除房间
  if (room.players.length === 0) {
    rooms.delete(roomId);
    return { room: null };
  }

  return { room };
}

/**
 * 设置准备状态
 */
export function setReady(roomId, playerId, ready) {
  const room = rooms.get(roomId);
  if (!room) return { error: '房间不存在' };

  const player = room.players.find(p => p.playerId === playerId);
  if (!player) return { error: '玩家不在房间中' };

  player.ready = ready;
  room.lastActivity = Date.now();
  return { room };
}

/**
 * 自动分配队伍
 */
export function autoAssignTeams(room) {
  const players = room.players.filter(p => !p.isAI);
  const half = Math.ceil(players.length / 2);
  room.teams.left = players.slice(0, half).map(p => p.playerId);
  room.teams.right = players.slice(half).map(p => p.playerId);

  // 更新每个玩家的team
  for (const p of room.players) {
    if (room.teams.left.includes(p.playerId)) p.team = 'left';
    else if (room.teams.right.includes(p.playerId)) p.team = 'right';
    else p.team = null;
  }
}

/**
 * 填充AI玩家到房间
 */
export function fillAIPlayers(room) {
  const targetCount = room.maxPlayers;
  const currentCount = room.players.filter(p => !p.isAI).length;
  const needed = targetCount - currentCount;

  if (needed <= 0) return;

  for (let i = 0; i < needed; i++) {
    const aiPlayer = {
      playerId: generatePlayerId(),
      userId: 'ai_' + generatePlayerId().slice(-6),
      username: `AI玩家${room.players.filter(p => p.isAI).length + 1}`,
      isAI: true,
      team: null,
      ready: true,
      connected: true,
      joinedAt: Date.now(),
    };
    room.players.push(aiPlayer);
  }

  autoAssignTeams(room);
}

/**
 * 所有玩家是否准备就绪
 */
export function allReady(room) {
  return room.players.length === room.maxPlayers &&
    room.players.every(p => p.ready);
}

/**
 * 匹配队列
 */
export function enqueueMatch(userId, username, mode, gameType) {
  // 移除已有匹配
  const idx = matchQueue.findIndex(e => e.userId === userId);
  if (idx !== -1) matchQueue.splice(idx, 1);

  matchQueue.push({ userId, username, mode, gameType, queuedAt: Date.now() });

  // 尝试匹配
  return tryMatch(mode, gameType);
}

export function dequeueMatch(userId) {
  const idx = matchQueue.findIndex(e => e.userId === userId);
  if (idx !== -1) {
    matchQueue.splice(idx, 1);
    return true;
  }
  return false;
}

/**
 * 尝试匹配玩家
 */
function tryMatch(mode, gameType) {
  const playersNeeded = mode === '1v1' ? 2 : mode === '2v2' ? 4 : 8;
  const candidates = matchQueue.filter(e => e.mode === mode && e.gameType === gameType);

  if (candidates.length >= playersNeeded) {
    const matched = candidates.splice(0, playersNeeded);
    // 从队列移除匹配上的玩家
    for (const m of matched) {
      dequeueMatch(m.userId);
    }

    // 创建房间
    const room = createRoom(matched[0].userId, matched[0].username, { mode, gameType });
    for (let i = 1; i < matched.length; i++) {
      joinRoom(room.roomId, matched[i].userId, matched[i].username);
    }

    return { matched: true, room };
  }

  return { matched: false };
}

/**
 * 获取房间列表
 */
export function listRooms(filterStatus) {
  const all = Array.from(rooms.values());
  if (filterStatus) return all.filter(r => r.status === filterStatus);
  return all;
}

/**
 * 获取房间
 */
export function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

/**
 * 玩家断连
 */
export function playerDisconnect(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const player = room.players.find(p => p.userId === userId);
  if (player) {
    player.connected = false;
    // 如果游戏正在进行，标记为AI托管
    if (room.status === '对弈中') {
      player.isAI = true;
    }
  }
}

/**
 * 玩家重连
 */
export function playerReconnect(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const player = room.players.find(p => p.userId === userId);
  if (player) {
    player.connected = true;
    // 如果之前是AI托管，恢复人类控制
    if (player.isAI && !player.userId.startsWith('ai_')) {
      player.isAI = false;
    }
  }
  return room;
}

/**
 * 清理长时间无活动的房间(5分钟)
 */
export function cleanInactiveRooms() {
  const now = Date.now();
  const timeout = 5 * 60 * 1000;
  for (const [roomId, room] of rooms) {
    if (now - room.lastActivity > timeout) {
      rooms.delete(roomId);
    }
  }
}
