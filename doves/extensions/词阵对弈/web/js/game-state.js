/**
 * 词阵对弈 - 客户端状态管理
 */
class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.players = [];
    this.myTeam = null;
    this.myPlayerId = null;
    this.currentPhase = 'lobby';
    this.round = 0;
    this.battleEffects = [];
    this.turnOrder = [];
  }

  init(data) {
    this.players = data.players || [];
    this.myTeam = data.teams ? this._findMyTeam(data) : null;
    this.currentPhase = data.phase || 'idiom_pick';
    if (window.myPlayerId) this.myPlayerId = window.myPlayerId;
  }

  _findMyTeam(data) {
    if (!this.myPlayerId) return null;
    if (data.teams?.left?.includes(this.myPlayerId)) return 'left';
    if (data.teams?.right?.includes(this.myPlayerId)) return 'right';
    return null;
  }

  setBattleData(data) {
    this.battleEffects = data.effects || [];
    this.turnOrder = data.turnOrder || [];
    if (data.players) {
      for (const p of data.players) {
        const existing = this.players.find(ep => ep.playerId === p.playerId);
        if (existing) Object.assign(existing, p);
        else this.players.push(p);
      }
    }
    this.currentPhase = 'battle';
  }

  getMyPlayer() {
    return this.players.find(p => p.playerId === this.myPlayerId);
  }

  getTeammates() {
    return this.players.filter(p => p.team === this.myTeam && p.playerId !== this.myPlayerId);
  }

  getEnemyPlayers() {
    return this.players.filter(p => p.team !== this.myTeam && (p.hp || 0) > 0);
  }

  updatePlayer(playerId, updates) {
    const p = this.players.find(pp => pp.playerId === playerId);
    if (p) Object.assign(p, updates);
  }

  updateFromSnapshot(playersSnapshot) {
    for (const snap of playersSnapshot) {
      const p = this.players.find(pp => pp.playerId === snap.playerId);
      if (p) Object.assign(p, snap);
    }
  }
}
