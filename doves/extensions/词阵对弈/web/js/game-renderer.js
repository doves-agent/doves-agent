/**
 * 词阵对弈 - CSS战斗动画渲染器
 */
class GameRenderer {
  constructor() {
    this.animating = false;
  }

  renderBattlefield(data, gameState) {
    const leftSide = document.getElementById('leftBattlePlayers');
    const rightSide = document.getElementById('rightBattlePlayers');

    const leftPlayers = data.players.filter(p => p.team === 'left');
    leftSide.innerHTML = leftPlayers.map(p => this._createPlayerCard(p)).join('');

    const rightPlayers = data.players.filter(p => p.team === 'right');
    rightSide.innerHTML = rightPlayers.map(p => this._createPlayerCard(p)).join('');

    this._updateTargetSelect(gameState);
  }

  _createPlayerCard(p) {
    const hpPct = (p.hp / (p.maxHp || 100)) * 100;
    const hpColor = hpPct > 60 ? '#4caf50' : hpPct > 30 ? '#ff9800' : '#f44336';
    const frozenClass = p.frozen ? ' frozen' : '';
    const silencedClass = p.silenced ? ' silenced' : '';
    const poisonedClass = p.poisoned ? ' poisoned' : '';
    const deadClass = p.hp <= 0 ? ' dead' : '';

    let statusHtml = '';
    if (p.frozen) statusHtml += '<div class="bp-status freeze-status">&#10052;&#65039; 冰冻</div>';
    if (p.silenced) statusHtml += '<div class="bp-status silence-status">&#128263; 禁手</div>';
    if (p.poisoned) statusHtml += '<div class="bp-status poison-status">&#9760;&#65039; 中毒</div>';
    if (p.hp <= 0) statusHtml += '<div class="bp-status dead-status">&#128128; 阵亡</div>';

    return `<div class="battle-player${frozenClass}${silencedClass}${poisonedClass}${deadClass}" id="bp_${p.playerId}" data-playerid="${p.playerId}">
      <div class="bp-name">${p.isAI ? '&#129302; ' : '&#128100; '}${p.username}</div>
      <div class="bp-hp-bar"><div class="bp-hp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
      <div class="bp-hp-text">HP: ${p.hp}/${p.maxHp || 100}</div>
      <div class="bp-vocab-text">&#128218; ${p.vocab || 0}</div>
      ${statusHtml}
    </div>`;
  }

  _updateTargetSelect(gameState) {
    const select = document.getElementById('targetSelect');
    const enemies = gameState.getEnemyPlayers();
    select.innerHTML = '<option value="">选择目标</option>' + enemies.map(e =>
      `<option value="${e.playerId}">${e.username} (HP: ${e.hp})</option>`
    ).join('');
  }

  startBattleAnimation() {
    const leftSide = document.querySelector('.left-side');
    const rightSide = document.querySelector('.right-side');

    if (leftSide) {
      leftSide.style.transition = 'transform 1s ease-in-out';
      leftSide.style.transform = 'translateX(30px)';
    }
    if (rightSide) {
      rightSide.style.transition = 'transform 1s ease-in-out';
      rightSide.style.transform = 'translateX(-30px)';
    }

    setTimeout(() => {
      const center = document.getElementById('battleCenter');
      if (center) {
        center.classList.add('collision');
        setTimeout(() => center.classList.remove('collision'), 500);
      }
    }, 1000);
  }

  handleAction(data) {
    const targetEl = document.getElementById('bp_' + data.targetId);
    if (!targetEl) return;

    if (data.effectApplied) {
      this._showEffectAnimation(targetEl, data.effectApplied);
    } else if (data.damage > 0) {
      targetEl.classList.add('take-damage');
      setTimeout(() => targetEl.classList.remove('take-damage'), 500);

      const dmgEl = document.createElement('div');
      dmgEl.className = 'damage-float';
      dmgEl.textContent = '-' + data.damage;
      targetEl.appendChild(dmgEl);
      setTimeout(() => dmgEl.remove(), 1000);
    }
  }

  _showEffectAnimation(el, effect) {
    const animationMap = {
      freeze: 'effect-freeze-anim',
      silence: 'effect-silence-anim',
      poison: 'effect-poison-anim',
      heal: 'effect-heal-anim',
      defense: 'effect-defense-anim',
      speed: 'effect-speed-anim',
      clear: 'effect-clear-anim',
      attack: 'take-damage',
    };

    const anim = animationMap[effect.type] || 'take-damage';
    el.classList.add(anim);
    setTimeout(() => el.classList.remove(anim), 800);

    // 效果文字浮动
    const textEl = document.createElement('div');
    textEl.className = 'effect-float effect-float-' + effect.type;
    const icons = { freeze: '&#10052;&#65039;', silence: '&#128263;', poison: '&#9760;&#65039;', heal: '&#128154;', defense: '&#128737;&#65039;', speed: '&#9889;', clear: '&#10024;', attack: '&#128165;' };
    textEl.innerHTML = icons[effect.type] || '';
    el.appendChild(textEl);
    setTimeout(() => textEl.remove(), 1200);
  }

  updatePlayers(gameState) {
    for (const p of gameState.players) {
      const el = document.getElementById('bp_' + p.playerId);
      if (!el) continue;

      const hpPct = ((p.hp || 0) / (p.maxHp || 100)) * 100;
      const fill = el.querySelector('.bp-hp-fill');
      const text = el.querySelector('.bp-hp-text');
      const vocabText = el.querySelector('.bp-vocab-text');
      const hpColor = hpPct > 60 ? '#4caf50' : hpPct > 30 ? '#ff9800' : '#f44336';

      if (fill) {
        fill.style.width = hpPct + '%';
        fill.style.background = hpColor;
      }
      if (text) text.textContent = 'HP: ' + (p.hp || 0) + '/' + (p.maxHp || 100);
      if (vocabText) vocabText.textContent = '\u{1F4DA} ' + (p.vocab || 0);

      el.classList.toggle('frozen', !!p.frozen);
      el.classList.toggle('silenced', !!p.silenced);
      el.classList.toggle('poisoned', !!p.poisoned);
      el.classList.toggle('dead', (p.hp || 0) <= 0);

      // 更新状态标记
      const existingStatuses = el.querySelectorAll('.bp-status');
      existingStatuses.forEach(s => s.remove());

      let statusHtml = '';
      if (p.frozen) statusHtml += '<div class="bp-status freeze-status">&#10052;&#65039; 冰冻</div>';
      if (p.silenced) statusHtml += '<div class="bp-status silence-status">&#128263; 禁手</div>';
      if (p.poisoned) statusHtml += '<div class="bp-status poison-status">&#9760;&#65039; 中毒</div>';
      if ((p.hp || 0) <= 0) statusHtml += '<div class="bp-status dead-status">&#128128; 阵亡</div>';
      if (statusHtml) el.insertAdjacentHTML('beforeend', statusHtml);
    }

    this._updateTargetSelect(gameState);
  }
}
