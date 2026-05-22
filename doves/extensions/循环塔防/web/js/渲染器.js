/**
 * 循环塔防 - Canvas 字符网格渲染器 (完整版)
 * 支持：平滑插值动画、弹道可视化、伤害飘字、特效粒子
 */

const 格宽 = 18;
const 格高 = 22;
const 字号 = 16;
const 字体 = `${字号}px "Courier New", monospace`;
const 小字体 = '11px "Courier New", monospace';
const 粗字体 = `bold ${字号}px "Courier New", monospace`;

const 段落宽度 = 7;
const 段落高度 = 12;
const 段间距 = 3;

const 玩家颜色 = [
  '#FF4444', '#4488FF', '#44FF44', '#FFFF44',
  '#FF44FF', '#44FFFF', '#FF8844', '#FFFFFF',
];

const 塔台符号 = { 箭塔: '♜', 冰塔: '♞', 炮塔: '♝', 电塔: '♛' };
const 塔台颜色 = { 箭塔: '#44cc44', 冰塔: '#44cccc', 炮塔: '#cc8844', 电塔: '#cccc44' };
const 兵种符号 = { 侦察兵: 'S', 重甲: 'T', 虫群: 'z', 精英: 'E' };

export class 渲染器 {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.状态 = null;
    this.上一状态 = null; // 用于插值
    this.mySlot = -1;
    this.选中塔类型 = null;
    this.hoveredCell = null;
    this.animFrame = null;
    this.lastTickTime = 0;
    this.tickDuration = 500;

    // 特效系统
    this.飘字列表 = []; // { text, x, y, color, born, duration }
    this.弹道列表 = []; // { fromX, fromY, toX, toY, born, duration, color, symbol }
    this.粒子列表 = []; // { x, y, vx, vy, color, born, duration }

    this._setupEvents();
  }

  设置状态(状态, mySlot) {
    this.上一状态 = this.状态;
    this.状态 = 状态;
    this.mySlot = mySlot;
    this.lastTickTime = performance.now();
    this._resize();
    this._处理事件特效();
  }

  _resize() {
    if (!this.状态) return;
    const 玩家数 = this.状态.段落.length;
    const totalW = 玩家数 * 段落宽度 + (玩家数 - 1) * 段间距 + 4;
    const totalH = 段落高度 + 7;
    this.canvas.width = totalW * 格宽;
    this.canvas.height = totalH * 格高;
  }

  开始渲染() {
    const loop = () => {
      this.绘制();
      this.animFrame = requestAnimationFrame(loop);
    };
    loop();
  }

  停止渲染() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.animFrame = null;
  }

  // ===== 主绘制循环 =====

  绘制() {
    const ctx = this.ctx;
    const 状态 = this.状态;
    if (!状态 || !状态.段落) return;

    const now = performance.now();
    const tickProgress = Math.min(1, (now - this.lastTickTime) / this.tickDuration);

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const 玩家数 = 状态.段落.length;

    // 绘制各段落
    for (let i = 0; i < 玩家数; i++) {
      const 段 = 状态.段落[i];
      const offsetX = (2 + i * (段落宽度 + 段间距)) * 格宽;
      const offsetY = 4 * 格高;

      this._绘制段落头(ctx, 段, offsetX, offsetY - 2.5 * 格高, i);
      this._绘制段落背景(ctx, 段, offsetX, offsetY, i);
      this._绘制塔台(ctx, 段, offsetX, offsetY, i);
      this._绘制单位(ctx, 段, offsetX, offsetY, i, tickProgress);
    }

    // 绘制特效层
    this._绘制弹道(ctx, now);
    this._绘制飘字(ctx, now);
    this._绘制粒子(ctx, now);

    // 底部信息
    ctx.fillStyle = '#444';
    ctx.font = '11px monospace';
    ctx.fillText(`Tick: ${状态.tick || 0}  |  ⟳ 攻击方向: P0→P1→P2→...→P0`, 格宽 * 2, this.canvas.height - 8);
  }

  // ===== 段落头部 =====

  _绘制段落头(ctx, 段, x, y, slot) {
    const color = 玩家颜色[slot];
    const isMe = slot === this.mySlot;

    ctx.font = isMe ? 粗字体 : 字体;
    ctx.fillStyle = isMe ? '#fff' : color;
    ctx.textBaseline = 'middle';
    ctx.fillText(段.用户名 || `P${slot}`, x, y + 格高 / 2);

    // HP 条
    const barW = 段落宽度 * 格宽 - 4;
    const barH = 10;
    const barX = x;
    const barY = y + 格高 + 4;

    ctx.fillStyle = '#222';
    ctx.fillRect(barX, barY, barW, barH);

    const hpRatio = Math.max(0, (段.基地HP || 0) / (段.最大HP || 100));
    const hpColor = hpRatio > 0.6 ? '#4a4' : hpRatio > 0.3 ? '#aa4' : '#c33';
    ctx.fillStyle = hpColor;
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    // 边框
    ctx.strokeStyle = '#444';
    ctx.strokeRect(barX, barY, barW, barH);

    // 数值
    ctx.font = 小字体;
    ctx.fillStyle = '#ddd';
    ctx.fillText(`♥${段.基地HP || 0}/${段.最大HP || 100}  💰${段.资源 || 0}`, x, barY + barH + 12);
    ctx.font = 字体;
  }

  // ===== 段落背景网格 =====

  _绘制段落背景(ctx, 段, offsetX, offsetY, slot) {
    const isMe = slot === this.mySlot;

    if (!段.存活) {
      ctx.fillStyle = '#111';
      ctx.fillRect(offsetX - 2, offsetY - 2, 段落宽度 * 格宽 + 4, 段落高度 * 格高 + 4);
      ctx.font = 粗字体;
      ctx.fillStyle = '#333';
      ctx.textBaseline = 'middle';
      ctx.fillText('☠ OUT', offsetX + 格宽 * 2, offsetY + 段落高度 * 格高 / 2);
      ctx.font = 字体;
      return;
    }

    // 边框
    if (isMe) {
      ctx.strokeStyle = '#555';
      ctx.strokeRect(offsetX - 3, offsetY - 3, 段落宽度 * 格宽 + 6, 段落高度 * 格高 + 6);
    }

    ctx.textBaseline = 'middle';

    for (let 行 = 0; 行 < 段落高度; 行++) {
      for (let 列 = 0; 列 < 段落宽度; 列++) {
        const cx = offsetX + 列 * 格宽;
        const cy = offsetY + 行 * 格高;
        const charY = cy + 格高 / 2;

        if (行 === 0) {
          // 入口
          ctx.fillStyle = '#666';
          ctx.fillText(列 === 3 ? '▽' : '─', cx, charY);
        } else if (行 === 段落高度 - 1) {
          // 出口
          ctx.fillStyle = '#666';
          ctx.fillText(列 === 3 ? '▽' : '─', cx, charY);
        } else if (列 === 0 || 列 === 段落宽度 - 1) {
          // 塔位
          ctx.fillStyle = isMe ? '#252525' : '#1a1a1a';
          ctx.fillText('░', cx, charY);
        } else {
          // 路径
          ctx.fillStyle = '#1a1a1a';
          ctx.fillText('·', cx, charY);
        }
      }
    }

    // hover 高亮
    if (this.选中塔类型 && isMe && this.hoveredCell) {
      const { 行, 列, 段落索引 } = this.hoveredCell;
      if (段落索引 === slot && (列 === 0 || 列 === 段落宽度 - 1) && 行 > 0 && 行 < 段落高度 - 1) {
        const cx = offsetX + 列 * 格宽;
        const cy = offsetY + 行 * 格高;
        ctx.strokeStyle = '#ffcc44';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx - 2, cy - 2, 格宽 + 4, 格高 + 4);
        ctx.lineWidth = 1;

        // 预览塔台符号
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = 塔台颜色[this.选中塔类型] || '#fff';
        ctx.fillText(塔台符号[this.选中塔类型] || '?', cx, cy + 格高 / 2);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ===== 塔台绘制 =====

  _绘制塔台(ctx, 段, offsetX, offsetY, slot) {
    if (!段.存活) return;
    ctx.textBaseline = 'middle';

    for (const 塔 of (段.塔台 || [])) {
      const cx = offsetX + 塔.位置.列 * 格宽;
      const cy = offsetY + 塔.位置.行 * 格高 + 格高 / 2;

      // 射程圈（浅色）
      if (slot === this.mySlot) {
        const range = this._获取塔射程(塔);
        ctx.beginPath();
        ctx.arc(cx + 格宽 / 2, cy, range * 格宽 * 0.7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.stroke();
      }

      // 塔台本体
      ctx.fillStyle = 塔台颜色[塔.类型] || '#fff';
      ctx.fillText(塔台符号[塔.类型] || '?', cx, cy);

      // 等级标记
      if (塔.等级 > 1) {
        ctx.font = '9px monospace';
        ctx.fillStyle = '#ff0';
        ctx.fillText(塔.等级 === 2 ? '★' : '★★', cx + 格宽 - 4, cy - 6);
        ctx.font = 字体;
      }

      // 冷却指示（闪烁）
      if (塔.当前冷却 > 0) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#000';
        ctx.fillRect(cx, cy - 格高 / 2, 格宽, 格高);
        ctx.globalAlpha = 1;
      }
    }
  }

  _获取塔射程(塔) {
    const base = { 箭塔: 3, 冰塔: 4, 炮塔: 2, 电塔: 5 };
    return (base[塔.类型] || 3) * [1, 1.4, 1.96][塔.等级 - 1];
  }

  // ===== 单位绘制（带插值） =====

  _绘制单位(ctx, 段, offsetX, offsetY, slot, tickProgress) {
    if (!段.存活) return;
    ctx.textBaseline = 'middle';

    for (const u of (段.单位 || [])) {
      // 插值位置（在两个 tick 之间平滑移动）
      let drawRow = u.位置.行;
      if (this.上一状态) {
        const 上段 = this.上一状态.段落[slot];
        if (上段) {
          const 旧单位 = (上段.单位 || []).find(old => old.id === u.id);
          if (旧单位) {
            drawRow = 旧单位.位置.行 + (u.位置.行 - 旧单位.位置.行) * tickProgress;
          }
        }
      }

      const drawRowClamped = Math.min(drawRow, 段落高度 - 1);
      const cx = offsetX + u.位置.列 * 格宽;
      const cy = offsetY + drawRowClamped * 格高 + 格高 / 2;

      // 减速效果：蓝色光晕
      if (u.减速 > 0) {
        ctx.fillStyle = 'rgba(68, 200, 255, 0.15)';
        ctx.beginPath();
        ctx.arc(cx + 格宽 / 2, cy, 格宽 * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // 单位本体
      const 攻击者颜色 = this._获取玩家颜色(u.所属玩家);
      ctx.fillStyle = u.减速 > 0 ? '#88ccff' : 攻击者颜色;
      ctx.font = 字体;
      ctx.fillText(兵种符号[u.类型] || '?', cx, cy);

      // HP 条（小）
      if (u.HP < (u.最大HP || u.HP)) {
        const hpW = 格宽 - 2;
        const hpH = 3;
        const hpX = cx;
        const hpY = cy - 格高 / 2 - 2;
        ctx.fillStyle = '#333';
        ctx.fillRect(hpX, hpY, hpW, hpH);
        const ratio = Math.max(0, u.HP / (u.最大HP || u.HP));
        ctx.fillStyle = ratio > 0.5 ? '#4a4' : '#a44';
        ctx.fillRect(hpX, hpY, hpW * ratio, hpH);
      }
    }
  }

  // ===== 弹道特效 =====

  _绘制弹道(ctx, now) {
    for (let i = this.弹道列表.length - 1; i >= 0; i--) {
      const b = this.弹道列表[i];
      const elapsed = now - b.born;
      if (elapsed > b.duration) {
        this.弹道列表.splice(i, 1);
        continue;
      }

      const t = elapsed / b.duration;
      const x = b.fromX + (b.toX - b.fromX) * t;
      const y = b.fromY + (b.toY - b.fromY) * t;

      ctx.fillStyle = b.color;
      ctx.globalAlpha = 1 - t * 0.5;
      ctx.font = '12px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.symbol, x, y);
      ctx.globalAlpha = 1;
    }
  }

  // ===== 飘字特效 =====

  _绘制飘字(ctx, now) {
    for (let i = this.飘字列表.length - 1; i >= 0; i--) {
      const f = this.飘字列表[i];
      const elapsed = now - f.born;
      if (elapsed > f.duration) {
        this.飘字列表.splice(i, 1);
        continue;
      }

      const t = elapsed / f.duration;
      const drawY = f.y - t * 20;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = f.color;
      ctx.font = '12px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.text, f.x, drawY);
      ctx.globalAlpha = 1;
    }
  }

  // ===== 粒子特效 =====

  _绘制粒子(ctx, now) {
    for (let i = this.粒子列表.length - 1; i >= 0; i--) {
      const p = this.粒子列表[i];
      const elapsed = now - p.born;
      if (elapsed > p.duration) {
        this.粒子列表.splice(i, 1);
        continue;
      }

      const t = elapsed / p.duration;
      const x = p.x + p.vx * elapsed * 0.001;
      const y = p.y + p.vy * elapsed * 0.001;

      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, 2, 2);
      ctx.globalAlpha = 1;
    }
  }

  // ===== 事件转特效 =====

  _处理事件特效() {
    if (!this.状态 || !this.状态.段落) return;
    const 事件列表 = [];

    // 从 tick_update 的事件缓冲提取
    for (const 段 of this.状态.段落) {
      // 自动从状态差异推导事件（已通过游戏状态.js处理）
    }
  }

  /**
   * 外部调用：添加事件特效
   */
  添加事件特效(事件, 段落索引) {
    const now = performance.now();
    const offsetX = (2 + 段落索引 * (段落宽度 + 段间距)) * 格宽;
    const offsetY = 4 * 格高;

    switch (事件.类型) {
      case '塔台开火': {
        // 找到塔台和目标位置生成弹道
        const 段 = this.状态?.段落[段落索引];
        if (!段) break;
        const 塔 = (段.塔台 || []).find(t => t.id === 事件.塔台);
        const 目标 = (段.单位 || []).find(u => u.id === 事件.目标);
        if (塔 && 目标) {
          const fromX = offsetX + 塔.位置.列 * 格宽 + 格宽 / 2;
          const fromY = offsetY + 塔.位置.行 * 格高 + 格高 / 2;
          const toX = offsetX + 目标.位置.列 * 格宽 + 格宽 / 2;
          const toY = offsetY + 目标.位置.行 * 格高 + 格高 / 2;
          const symbols = { 箭塔: '→', 冰塔: '~', 炮塔: '◎', 电塔: '⚡' };
          this.弹道列表.push({
            fromX, fromY, toX, toY,
            born: now, duration: 200,
            color: 塔台颜色[塔.类型] || '#fff',
            symbol: symbols[塔.类型] || '*',
          });
        }
        break;
      }

      case '单位死亡': {
        // 击杀飘字 + 爆炸粒子
        const x = offsetX + 3 * 格宽;
        const y = offsetY + 6 * 格高;
        this.飘字列表.push({ text: `+$${事件.赏金}`, x, y, color: '#ff0', born: now, duration: 1000 });
        for (let i = 0; i < 5; i++) {
          this.粒子列表.push({
            x, y,
            vx: (Math.random() - 0.5) * 60,
            vy: (Math.random() - 0.5) * 60,
            color: '#f84',
            born: now, duration: 500,
          });
        }
        break;
      }

      case '基地受损': {
        const x = offsetX + 3 * 格宽;
        const y = offsetY + 格高;
        this.飘字列表.push({ text: `-${事件.伤害}HP`, x, y, color: '#f44', born: now, duration: 1200 });
        // 屏幕震动效果通过红色闪烁
        for (let i = 0; i < 8; i++) {
          this.粒子列表.push({
            x: x + (Math.random() - 0.5) * 段落宽度 * 格宽,
            y: y,
            vx: (Math.random() - 0.5) * 40,
            vy: Math.random() * -30,
            color: '#f22',
            born: now, duration: 600,
          });
        }
        break;
      }

      case '玩家淘汰': {
        const x = offsetX + 段落宽度 * 格宽 / 2;
        const y = offsetY + 段落高度 * 格高 / 2;
        this.飘字列表.push({ text: '💀 OUT!', x: x - 格宽, y, color: '#f44', born: now, duration: 2000 });
        for (let i = 0; i < 20; i++) {
          this.粒子列表.push({
            x, y,
            vx: (Math.random() - 0.5) * 100,
            vy: (Math.random() - 0.5) * 100,
            color: ['#f44', '#ff4', '#f84'][Math.floor(Math.random() * 3)],
            born: now, duration: 1000,
          });
        }
        break;
      }
    }
  }

  // ===== 辅助 =====

  _获取玩家颜色(玩家ID) {
    if (!this.状态) return '#fff';
    const idx = this.状态.段落.findIndex(s => s.玩家ID === 玩家ID);
    return 玩家颜色[idx >= 0 ? idx : 0];
  }

  // ===== 交互事件 =====

  _setupEvents() {
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.状态 || this.mySlot < 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (this.canvas.height / rect.height);

      // 检测在哪个段落
      const 玩家数 = this.状态.段落.length;
      this.hoveredCell = null;

      for (let i = 0; i < 玩家数; i++) {
        const segX = (2 + i * (段落宽度 + 段间距)) * 格宽;
        const segY = 4 * 格高;

        const 列 = Math.floor((mx - segX) / 格宽);
        const 行 = Math.floor((my - segY) / 格高);

        if (列 >= 0 && 列 < 段落宽度 && 行 >= 0 && 行 < 段落高度) {
          this.hoveredCell = { 行, 列, 段落索引: i };
          break;
        }
      }
    });

    this.canvas.addEventListener('click', (e) => {
      if (!this.选中塔类型 || !this.hoveredCell || !this.onBuild) return;
      const { 行, 列, 段落索引 } = this.hoveredCell;
      if (段落索引 !== this.mySlot) return;
      if ((列 === 0 || 列 === 段落宽度 - 1) && 行 > 0 && 行 < 段落高度 - 1) {
        this.onBuild(this.选中塔类型, { 行, 列 });
      }
    });

    // 右键取消选择
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.选中塔类型 = null;
      document.querySelectorAll('.build-btn').forEach(b => b.classList.remove('selected'));
    });
  }

  onBuild = null;
}
