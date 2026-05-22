/**
 * 循环塔防 - 前端主入口 (完整版)
 * 整合：游戏客户端 + 游戏状态 + 渲染器 + UI面板 + 统计
 */

import { 游戏客户端 } from './游戏客户端.js';
import { 游戏状态 } from './游戏状态.js';
import { 渲染器 } from './渲染器.js';
import { 战报面板, 状态总览面板, 通知系统 } from './UI面板.js';

const client = new 游戏客户端();
const state = new 游戏状态();
let renderer = null;
let battleLog = null;
let statusPanel = null;
let notifications = null;
let currentRoomId = null;

// ===== 界面切换 =====

function 显示界面(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===== 大厅 =====

document.getElementById('create-btn').onclick = async () => {
  const nickname = document.getElementById('nickname-input').value.trim() || '玩家';

  try {
    await client.连接(nickname);
    注册事件监听();

    const resp = await client.发送('create_room', {
      模式: document.getElementById('mode-select').value,
      玩家上限: parseInt(document.getElementById('player-count-select').value),
      AI填充: document.getElementById('ai-fill-check').checked,
      AI难度: document.getElementById('ai-difficulty-select').value,
    });

    if (resp.success) {
      currentRoomId = resp.room.roomId;
      state.设置房间(currentRoomId, resp.playerId);
      显示等待界面(resp.room);
    }
  } catch (e) {
    alert('连接失败: ' + e.message);
  }
};

document.getElementById('refresh-btn').onclick = async () => {
  if (!client.ws || client.ws.readyState !== WebSocket.OPEN) {
    const nickname = document.getElementById('nickname-input').value.trim() || '玩家';
    try {
      await client.连接(nickname);
      注册事件监听();
    } catch (e) {
      alert('连接失败: ' + e.message);
      return;
    }
  }
  const resp = await client.发送('list_rooms');
  if (resp.success) 渲染房间列表(resp.rooms);
};

function 渲染房间列表(rooms) {
  const container = document.getElementById('room-list');
  if (rooms.length === 0) {
    container.innerHTML = '<p style="color:#555;padding:12px">暂无房间，创建一个吧</p>';
    return;
  }
  container.innerHTML = rooms.map(r => `
    <div class="room-item">
      <div class="info">
        <span class="mode">${r.模式}</span>
        <span class="players">${r.players.length}/${r.玩家上限}</span>
        <span style="color:#555;font-size:11px;margin-left:8px">${r.status}</span>
      </div>
      <button class="btn small" onclick="window.加入房间('${r.roomId}')">加入</button>
    </div>
  `).join('');
}

window.加入房间 = async (roomId) => {
  if (!client.ws || client.ws.readyState !== WebSocket.OPEN) {
    const nickname = document.getElementById('nickname-input').value.trim() || '玩家';
    await client.连接(nickname);
    注册事件监听();
  }
  const resp = await client.发送('join_room', { roomId });
  if (resp.success) {
    currentRoomId = roomId;
    state.设置房间(roomId, resp.playerId);
    显示等待界面(resp.room);
  } else {
    alert(resp.error);
  }
};

// ===== 等待界面 =====

function 显示等待界面(room) {
  显示界面('waiting-screen');
  document.getElementById('room-id-display').textContent = room.roomId.slice(-8);
  document.getElementById('room-mode-display').textContent = room.模式;
  更新玩家列表(room.players);

  const isHost = room.hostUserId === client.userId;
  document.getElementById('start-btn').style.display = isHost ? '' : 'none';
}

function 更新玩家列表(players) {
  document.getElementById('player-list').innerHTML = players.map((p, i) => {
    const colors = ['#F44', '#48F', '#4F4', '#FF4', '#F4F', '#4FF', '#F84', '#FFF'];
    return `
      <div class="player-card ${p.ready ? 'ready' : ''}" style="border-color:${colors[i]}44">
        <div class="name" style="color:${colors[i]}">${p.username}${p.isAI ? ' 🤖' : ''}</div>
        <div class="slot">位置 ${i + 1}</div>
        <div class="status">${p.ready ? '✓ 就绪' : '⏳ 等待'}</div>
      </div>
    `;
  }).join('');
}

document.getElementById('ready-btn').onclick = async () => {
  const btn = document.getElementById('ready-btn');
  const isReady = btn.dataset.ready === 'true';
  await client.发送('set_ready', { roomId: currentRoomId, ready: !isReady });
  btn.dataset.ready = !isReady;
  btn.textContent = !isReady ? '取消准备' : '准备';
  btn.className = !isReady ? 'btn danger' : 'btn';
};

document.getElementById('start-btn').onclick = async () => {
  const resp = await client.发送('start_game', { roomId: currentRoomId });
  if (!resp.success) alert(resp.error);
};

document.getElementById('leave-btn').onclick = async () => {
  await client.发送('leave_room', { roomId: currentRoomId });
  currentRoomId = null;
  state.重置();
  显示界面('lobby-screen');
};

// ===== 游戏界面 =====

function 进入游戏(data) {
  state.初始化游戏(data);
  显示界面('game-screen');

  // 初始化渲染器
  const canvas = document.getElementById('game-canvas');
  renderer = new 渲染器(canvas);
  renderer.设置状态(state, state.获取我的槽位());
  renderer.onBuild = (类型, 位置) => {
    client.发送('建造塔台', { roomId: currentRoomId, 类型, 位置 });
  };
  renderer.开始渲染();

  // 初始化 UI 面板
  battleLog = new 战报面板(document.getElementById('event-log'));
  battleLog.添加('游戏开始！建塔防守，出兵进攻！', '#ffcc44', 0);

  const statusContainer = document.getElementById('my-status');
  statusContainer.innerHTML = '';
  statusPanel = new 状态总览面板(statusContainer);
  statusPanel.更新(state, state.获取我的槽位());

  // 通知系统
  if (!document.getElementById('notification-layer')) {
    const layer = document.createElement('div');
    layer.id = 'notification-layer';
    document.getElementById('game-screen').appendChild(layer);
  }
  notifications = new 通知系统(document.getElementById('notification-layer'));
  notifications.显示('⚔️ 战斗开始！', 'info');

  更新按钮状态();
}

function 更新按钮状态() {
  const 段 = state.获取我的段落();
  if (!段) return;
  const 资源 = 段.资源 || 0;

  document.querySelectorAll('.build-btn').forEach(btn => {
    const cost = parseInt(btn.dataset.cost);
    btn.disabled = 资源 < cost;
  });
  document.querySelectorAll('.spawn-btn').forEach(btn => {
    const cost = parseInt(btn.dataset.cost);
    btn.disabled = 资源 < cost;
  });
}

// ===== 建造/出兵按钮 =====

document.querySelectorAll('.build-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.build-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    if (renderer) renderer.选中塔类型 = btn.dataset.type;
  };
});

document.querySelectorAll('.spawn-btn').forEach(btn => {
  btn.onclick = async () => {
    const type = btn.dataset.type;
    const resp = await client.发送('生产单位', { roomId: currentRoomId, 类型: type, 数量: 1 });
    if (resp.success) {
      notifications.显示(`🚀 出兵: ${type}`, 'spawn');
    } else if (resp.error) {
      notifications.显示(`❌ ${resp.error}`, 'error');
    }
  };
});

// ===== 服务器事件监听 =====

function 注册事件监听() {
  client.on('room_update', (data) => {
    if (state.阶段 === 'waiting') {
      更新玩家列表(data.players);
    }
  });

  client.on('game_start', (data) => {
    进入游戏(data);
  });

  client.on('tick_update', (data) => {
    state.更新tick(data);
    if (renderer) {
      renderer.设置状态(state, state.获取我的槽位());
    }
    if (statusPanel) {
      statusPanel.更新(state, state.获取我的槽位());
    }
    更新按钮状态();

    // 处理事件特效和战报
    if (data.事件) {
      for (const ev of data.事件) {
        处理游戏事件(ev, data.tick);
      }
    }
  });

  client.on('game_over', (data) => {
    if (renderer) renderer.停止渲染();
    显示结算(data);
  });

  client.on('onDisconnect', () => {
    if (renderer) renderer.停止渲染();
    显示界面('lobby-screen');
    alert('连接断开');
  });
}

function 处理游戏事件(ev, tick) {
  switch (ev.类型) {
    case '单位生成':
      battleLog?.添加(`${ev.来源} 出兵: ${ev.单位类型}×${ev.数量}`, '#88f', tick);
      break;
    case '单位死亡':
      battleLog?.添加(`击杀! +$${ev.赏金}`, '#ff4', tick);
      if (renderer) renderer.添加事件特效(ev, ev.段落);
      break;
    case '基地受损':
      battleLog?.添加(`基地受损 -${ev.伤害}HP → ${ev.剩余HP}HP`, '#f44', tick);
      if (renderer) renderer.添加事件特效(ev, ev.段落);
      if (ev.段落 === state.获取我的槽位()) {
        notifications?.显示(`⚠️ 基地受损 -${ev.伤害}HP!`, 'damage');
      }
      break;
    case '玩家淘汰':
      battleLog?.添加(`💀 玩家淘汰!`, '#f44', tick);
      notifications?.显示(`☠️ 玩家被淘汰!`, 'kill');
      if (renderer) renderer.添加事件特效(ev, ev.段落);
      break;
    case '塔台开火':
      if (renderer) renderer.添加事件特效(ev, ev.段落);
      break;
    case '资源继承':
      battleLog?.添加(`队友遗产: +$${ev.均分}`, '#4f4', tick);
      break;
  }
}

// ===== 结算界面 =====

function 显示结算(data) {
  显示界面('result-screen');

  const myId = state.myPlayerId;
  const isWinner = data.胜者 === myId || (data.队伍成员 && data.队伍成员.includes(myId));

  document.getElementById('result-title').textContent = isWinner ? '🎉 胜利!' : '💀 战败';
  document.getElementById('result-title').style.color = isWinner ? '#ffcc44' : '#ff4444';

  const minutes = Math.floor(data.tick数 * 0.5 / 60);
  const seconds = Math.round((data.tick数 * 0.5) % 60);

  let statsHTML = `
    <div class="result-info">
      <p>⏱ 游戏时长: ${minutes}分${seconds}秒 (${data.tick数} ticks)</p>
      ${data.胜利队伍 ? `<p>🏆 获胜队伍: ${data.胜利队伍}</p>` : ''}
      <p>☠ 淘汰顺序:</p>
      <ol class="elimination-list">
  `;

  for (const id of (data.淘汰顺序 || [])) {
    const 段 = state.段落.find(s => s.玩家ID === id);
    statsHTML += `<li>${段?.用户名 || id}</li>`;
  }

  statsHTML += `</ol></div>`;

  // 玩家统计卡片
  statsHTML += '<div class="result-cards">';
  for (const 段 of state.段落) {
    const isMe = 段.玩家ID === myId;
    const survived = 段.存活;
    statsHTML += `
      <div class="result-card ${isMe ? 'me' : ''} ${survived ? 'winner' : ''}">
        <div class="card-name">${段.用户名}${段.isAI ? ' 🤖' : ''}</div>
        <div class="card-status">${survived ? '🏆 存活' : '☠ 淘汰'}</div>
        <div class="card-stats">
          <span>🏗 ${(段.塔台 || []).length}塔</span>
          <span>💰 ${段.资源}金</span>
        </div>
      </div>
    `;
  }
  statsHTML += '</div>';

  document.getElementById('result-stats').innerHTML = statsHTML;
}

document.getElementById('back-lobby-btn').onclick = () => {
  state.重置();
  currentRoomId = null;
  renderer = null;
  battleLog = null;
  statusPanel = null;
  显示界面('lobby-screen');
};
