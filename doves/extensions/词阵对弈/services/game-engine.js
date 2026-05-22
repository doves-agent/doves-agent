/**
 * 词阵对弈 - 游戏引擎
 * 核心状态机、战斗逻辑、回合结算、效果系统
 */

export const PHASE = {
  LOBBY: 'lobby',
  IDIOM_PICK: 'idiom_pick',
  BATTLE_PREP: 'battle_prep',
  BATTLE: 'battle',
  ROUND_END: 'round_end',
  VICTORY: 'victory',
};

export const EFFECT_TYPES = {
  ATTACK: 'attack',
  DEFENSE: 'defense',
  SPEED: 'speed',
  FREEZE: 'freeze',
  SILENCE: 'silence',
  HEAL: 'heal',
  POISON: 'poison',
  CLEAR: 'clear',
};

// 特殊词语 → 效果映射（用于战斗阶段即时效果判定）
const EFFECT_WORD_MAP = {
  // 冰冻类
  '冰天雪地': { type: 'freeze', value: 0, description: '冰天雪地——冻结对手' },
  '天寒地冻': { type: 'freeze', value: 0, description: '天寒地冻——冻结对手' },
  '滴水成冰': { type: 'freeze', value: 0, description: '滴水成冰——冻结对手' },
  '冰封万里': { type: 'freeze', value: 0, description: '冰封万里——冻结对手' },
  // 加速类
  '风驰电掣': { type: 'speed', value: 3, description: '风驰电掣——提升速度' },
  '疾如闪电': { type: 'speed', value: 3, description: '疾如闪电——提升速度' },
  '健步如飞': { type: 'speed', value: 2, description: '健步如飞——提升速度' },
  '一日千里': { type: 'speed', value: 4, description: '一日千里——大幅提升速度' },
  // 治疗类
  '枯木逢春': { type: 'heal', value: 20, description: '枯木逢春——回复生命' },
  '妙手回春': { type: 'heal', value: 25, description: '妙手回春——大量回复生命' },
  '起死回生': { type: 'heal', value: 30, description: '起死回生——强力回复' },
  '春风化雨': { type: 'heal', value: 15, description: '春风化雨——温和回复' },
  // 中毒类
  '含沙射影': { type: 'poison', value: 5, description: '含沙射影——持续伤害' },
  '暗箭伤人': { type: 'poison', value: 6, description: '暗箭伤人——持续伤害' },
  '口蜜腹剑': { type: 'poison', value: 7, description: '口蜜腹剑——强力持续伤害' },
  // 禁手类
  '鸦雀无声': { type: 'silence', value: 0, description: '鸦雀无声——封锁对手' },
  '噤若寒蝉': { type: 'silence', value: 0, description: '噤若寒蝉——封锁对手' },
  '万马齐喑': { type: 'silence', value: 0, description: '万马齐喑——封锁对手' },
  // 防御类
  '固若金汤': { type: 'defense', value: 5, description: '固若金汤——提升防御' },
  '铜墙铁壁': { type: 'defense', value: 6, description: '铜墙铁壁——大幅提升防御' },
  '坚不可摧': { type: 'defense', value: 7, description: '坚不可摧——强力防御' },
  '金城汤池': { type: 'defense', value: 5, description: '金城汤池——提升防御' },
  // 清除类
  '拨云见日': { type: 'clear', value: 0, description: '拨云见日——清除负面效果' },
  '柳暗花明': { type: 'clear', value: 0, description: '柳暗花明——清除负面效果' },
  '否极泰来': { type: 'clear', value: 0, description: '否极泰来——清除负面效果' },
};

/**
 * 初始化游戏状态
 */
export function initGameState(room) {
  const gameState = {
    phase: PHASE.IDIOM_PICK,
    round: 0,
    players: {},
    turnOrder: [],
    currentTurn: null,
    battleLog: [],
    winner: null,
    startTime: Date.now(),
    roundTimer: null,
  };

  for (const player of room.players) {
    let baseAttack = 10, baseDefense = 5, baseSpeed = 5, baseVocabRate = 8;

    if (player.isAI) {
      const diff = room.settings?.aiDifficulty || 'medium';
      if (diff === 'easy') { baseAttack = 7; baseDefense = 3; baseSpeed = 3; baseVocabRate = 6; }
      else if (diff === 'hard') { baseAttack = 14; baseDefense = 7; baseSpeed = 7; baseVocabRate = 12; }
    }

    gameState.players[player.playerId] = {
      playerId: player.playerId,
      username: player.username,
      team: player.team,
      isAI: player.isAI,
      hp: 100,
      maxHp: 100,
      vocab: 20,
      vocabRate: baseVocabRate,
      attack: baseAttack,
      defense: baseDefense,
      speed: baseSpeed,
      effects: [],
      frozen: false,
      silenced: false,
      poisoned: false,
      poisonDamage: 0,
      selectedIdioms: [],
      idiomPicked: false,
      actedThisRound: false,
    };
  }

  gameState.turnOrder = room.players
    .sort((a, b) => {
      const aSpeed = gameState.players[a.playerId]?.speed || 5;
      const bSpeed = gameState.players[b.playerId]?.speed || 5;
      return bSpeed - aSpeed;
    })
    .map(p => p.playerId);

  room.gameState = gameState;
  return gameState;
}

/**
 * 玩家选词
 */
export function playerPickIdiom(room, playerId, idiom, meaning) {
  const gs = room.gameState;
  if (!gs || gs.phase !== PHASE.IDIOM_PICK) {
    return { error: '当前不是选词阶段' };
  }

  const playerState = gs.players[playerId];
  if (!playerState) return { error: '玩家不存在' };
  if (playerState.idiomPicked) return { error: '已经选过词了' };

  playerState.idiomPicked = true;
  playerState.selectedIdioms.push({ idiom, meaning, round: 0 });

  const allPicked = Object.values(gs.players).every(p => p.idiomPicked);
  if (allPicked) {
    gs.phase = PHASE.BATTLE_PREP;
    return { allPicked: true, phase: PHASE.BATTLE_PREP };
  }

  const pickedCount = Object.values(gs.players).filter(p => p.idiomPicked).length;
  return { allPicked: false, pickedCount, totalCount: Object.keys(gs.players).length };
}

/**
 * 进入战斗阶段
 */
export function startBattle(room, battleEffects) {
  const gs = room.gameState;
  if (!gs) return { error: '游戏状态不存在' };

  gs.phase = PHASE.BATTLE;
  gs.round = 1;
  gs.battleEffects = battleEffects;

  applyInitialEffects(room, battleEffects);

  // 重置行动标记
  for (const ps of Object.values(gs.players)) {
    ps.actedThisRound = false;
  }

  return { success: true, gameState: gs };
}

/**
 * 应用初始效果（开局成语效果）
 */
function applyInitialEffects(room, battleEffects) {
  const gs = room.gameState;
  if (!battleEffects?.battleEffects) return;

  for (const be of battleEffects.battleEffects) {
    const playerState = gs.players[be.playerId];
    if (!playerState) continue;

    // 初始效果作用于对方
    const targets = Object.values(gs.players).filter(p => p.team !== playerState.team && p.hp > 0);
    if (be.effect.type === 'attack' && targets.length > 0) {
      const target = targets[Math.floor(Math.random() * targets.length)];
      applyEffectToPlayer(gs, target, be.effect);
    } else if (be.effect.type === 'defense' || be.effect.type === 'speed' || be.effect.type === 'heal') {
      applyEffectToPlayer(gs, playerState, be.effect);
    } else if (targets.length > 0) {
      const target = targets[Math.floor(Math.random() * targets.length)];
      applyEffectToPlayer(gs, target, be.effect);
    }
  }
}

/**
 * 应用效果到玩家
 */
function applyEffectToPlayer(gs, playerState, effect) {
  switch (effect.type) {
    case 'attack': {
      const damage = Math.max(1, effect.value - playerState.defense);
      playerState.hp = Math.max(0, playerState.hp - damage);
      gs.battleLog.push(`${playerState.username} 受到 ${damage} 点伤害(${effect.description})`);
      break;
    }
    case 'defense':
      playerState.defense += effect.value;
      gs.battleLog.push(`${playerState.username} 防御提升 ${effect.value} 点(${effect.description})`);
      break;
    case 'speed':
      playerState.speed += effect.value;
      gs.battleLog.push(`${playerState.username} 速度提升 ${effect.value} 点(${effect.description})`);
      break;
    case 'heal': {
      const heal = Math.min(effect.value, playerState.maxHp - playerState.hp);
      playerState.hp += heal;
      gs.battleLog.push(`${playerState.username} 回复 ${heal} 点生命(${effect.description})`);
      break;
    }
    case 'freeze':
      playerState.frozen = true;
      playerState.effects.push({ type: 'freeze', duration: 1, source: effect.description });
      gs.battleLog.push(`${playerState.username} 被冰冻了！(${effect.description})`);
      break;
    case 'silence':
      playerState.silenced = true;
      playerState.effects.push({ type: 'silence', duration: 2, source: effect.description });
      gs.battleLog.push(`${playerState.username} 被禁手了！(${effect.description})`);
      break;
    case 'poison':
      playerState.poisoned = true;
      playerState.poisonDamage = effect.value || 5;
      playerState.effects.push({ type: 'poison', duration: 3, source: effect.description });
      gs.battleLog.push(`${playerState.username} 中毒了，每回合损失 ${playerState.poisonDamage} 生命(${effect.description})`);
      break;
    case 'clear':
      playerState.effects = [];
      playerState.frozen = false;
      playerState.silenced = false;
      playerState.poisoned = false;
      playerState.poisonDamage = 0;
      gs.battleLog.push(`${playerState.username} 清除了所有负面效果！(${effect.description})`);
      break;
  }
}

/**
 * 玩家使用词语攻击（含效果判定）
 */
export function playerUseWord(room, playerId, word, meaning, targetId) {
  const gs = room.gameState;
  if (!gs || gs.phase !== PHASE.BATTLE) return { error: '当前不是战斗阶段' };

  const playerState = gs.players[playerId];
  if (!playerState) return { error: '玩家不存在' };
  if (playerState.hp <= 0) return { error: '你已阵亡' };
  if (playerState.frozen) return { error: '你被冰冻了，无法行动' };

  // 检查词汇量消耗
  const vocabCost = word.length * 3;
  if (playerState.vocab < vocabCost) {
    return { error: `词汇量不足(需要${vocabCost})，当前词汇量: ${playerState.vocab}` };
  }

  // 消耗词汇量
  playerState.vocab -= vocabCost;
  playerState.actedThisRound = true;

  // 判断是否为特殊效果词语
  const specialEffect = EFFECT_WORD_MAP[word];
  if (specialEffect) {
    return applySpecialWord(gs, playerState, word, specialEffect, targetId);
  }

  // 普通攻击（禁手状态可以普通攻击，但不能施加效果）
  const target = Object.values(gs.players).find(p =>
    p.playerId === targetId && p.team !== playerState.team && p.hp > 0
  );
  if (!target) return { error: '无效的目标' };

  let rawDamage = word.length * 3 + playerState.attack;
  const reducedDamage = Math.max(1, rawDamage - target.defense);
  target.hp = Math.max(0, target.hp - reducedDamage);

  gs.battleLog.push(`${playerState.username} 使用"${word}"对${target.username}造成${reducedDamage}点伤害！`);

  const winResult = checkVictory(gs);
  if (winResult) {
    return { win: true, winner: winResult, battleLog: gs.battleLog, effectApplied: null };
  }

  return {
    win: false,
    damage: reducedDamage,
    targetId: target.playerId,
    playerVocab: playerState.vocab,
    targetHp: target.hp,
    effectApplied: null,
  };
}

/**
 * 施加特殊效果词语
 */
function applySpecialWord(gs, playerState, word, effect, targetId) {
  // 禁手状态不能使用特殊效果
  if (playerState.silenced && effect.type !== 'attack') {
    return { error: '你被禁手了，无法使用特殊效果词语' };
  }

  const isSelfBuff = ['defense', 'speed', 'heal', 'clear'].includes(effect.type);

  if (isSelfBuff) {
    applyEffectToPlayer(gs, playerState, effect);
    return {
      win: false,
      damage: 0,
      targetId: playerState.playerId,
      playerVocab: playerState.vocab,
      targetHp: playerState.hp,
      effectApplied: { type: effect.type, description: effect.description, targetId: playerState.playerId },
    };
  }

  // 对敌方施加效果
  const target = Object.values(gs.players).find(p =>
    p.playerId === targetId && p.team !== playerState.team && p.hp > 0
  );
  if (!target) return { error: '无效的目标' };

  applyEffectToPlayer(gs, target, effect);

  const winResult = checkVictory(gs);
  if (winResult) {
    return { win: true, winner: winResult, battleLog: gs.battleLog, effectApplied: { type: effect.type, description: effect.description, targetId: target.playerId } };
  }

  return {
    win: false,
    damage: effect.type === 'attack' ? effect.value : 0,
    targetId: target.playerId,
    playerVocab: playerState.vocab,
    targetHp: target.hp,
    effectApplied: { type: effect.type, description: effect.description, targetId: target.playerId },
  };
}

/**
 * 回合更新（由服务端定时调用）
 * 返回本回合结算日志
 */
export function updateRound(room) {
  const gs = room.gameState;
  if (!gs || gs.phase !== PHASE.BATTLE) return null;

  gs.round++;
  const roundLog = [];

  // 1. 中毒伤害结算
  for (const ps of Object.values(gs.players)) {
    if (ps.poisoned && ps.hp > 0) {
      ps.hp = Math.max(0, ps.hp - ps.poisonDamage);
      const msg = `${ps.username} 受到 ${ps.poisonDamage} 点毒伤害`;
      gs.battleLog.push(msg);
      roundLog.push(msg);
    }
  }

  // 2. 效果持续时间递减
  for (const ps of Object.values(gs.players)) {
    ps.effects = ps.effects.filter(e => {
      e.duration--;
      if (e.duration <= 0) {
        if (e.type === 'freeze') {
          ps.frozen = false;
          const msg = `${ps.username} 解除了冰冻`;
          roundLog.push(msg);
        }
        if (e.type === 'silence') {
          ps.silenced = false;
          const msg = `${ps.username} 解除了禁手`;
          roundLog.push(msg);
        }
        if (e.type === 'poison') {
          ps.poisoned = false;
          ps.poisonDamage = 0;
          const msg = `${ps.username} 的毒素消退了`;
          roundLog.push(msg);
        }
        return false;
      }
      return true;
    });
  }

  // 3. 词汇量增长（存活玩家）
  for (const ps of Object.values(gs.players)) {
    if (ps.hp > 0) {
      ps.vocab += ps.vocabRate;
    }
  }

  // 4. 重置行动标记
  for (const ps of Object.values(gs.players)) {
    ps.actedThisRound = false;
  }

  // 5. 更新回合顺序
  gs.turnOrder = Object.entries(gs.players)
    .filter(([, ps]) => ps.hp > 0)
    .sort(([, a], [, b]) => b.speed - a.speed)
    .map(([id]) => id);

  // 6. 胜负检测
  const winResult = checkVictory(gs);
  if (winResult) {
    return { win: true, winner: winResult, roundLog };
  }

  return { win: false, round: gs.round, roundLog };
}

/**
 * 检查胜负
 */
function checkVictory(gs) {
  const teamLeft = Object.values(gs.players).filter(p => p.team === 'left');
  const teamRight = Object.values(gs.players).filter(p => p.team === 'right');

  if (teamLeft.every(p => p.hp <= 0)) {
    gs.phase = PHASE.VICTORY;
    gs.winner = 'right';
    gs.battleLog.push('右队获胜！');
    return 'right';
  }

  if (teamRight.every(p => p.hp <= 0)) {
    gs.phase = PHASE.VICTORY;
    gs.winner = 'left';
    gs.battleLog.push('左队获胜！');
    return 'left';
  }

  return null;
}

/**
 * 获取可序列化的玩家状态快照
 */
export function getPlayersSnapshot(gs) {
  return Object.values(gs.players).map(p => ({
    playerId: p.playerId,
    hp: p.hp,
    maxHp: p.maxHp,
    vocab: p.vocab,
    attack: p.attack,
    defense: p.defense,
    speed: p.speed,
    frozen: p.frozen,
    silenced: p.silenced,
    poisoned: p.poisoned,
  }));
}

export default {
  PHASE,
  EFFECT_TYPES,
  EFFECT_WORD_MAP,
  initGameState,
  playerPickIdiom,
  startBattle,
  playerUseWord,
  updateRound,
  checkVictory,
  getPlayersSnapshot,
};
