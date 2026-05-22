/**
 * 循环塔防 - UI 文本面板
 * 基于 Canvas 的高效文本布局渲染（受 Pretext 启发）
 * 用于战报面板、玩家状态栏等 UI 元素
 *
 * 核心思路：预测量字符宽度 → 纯算术换行 → 批量 fillText
 * 避免 DOM reflow，每 tick 可高频更新
 */

// ===== 文本测量缓存 =====

const 宽度缓存 = new Map(); // font → Map<char, width>
let 测量Canvas = null;
let 测量Ctx = null;

function 获取测量上下文() {
  if (!测量Canvas) {
    测量Canvas = document.createElement('canvas');
    测量Ctx = 测量Canvas.getContext('2d');
  }
  return 测量Ctx;
}

function 测量文本宽度(text, font) {
  const ctx = 获取测量上下文();
  ctx.font = font;

  if (!宽度缓存.has(font)) 宽度缓存.set(font, new Map());
  const cache = 宽度缓存.get(font);

  let totalWidth = 0;
  for (const ch of text) {
    if (!cache.has(ch)) {
      cache.set(ch, ctx.measureText(ch).width);
    }
    totalWidth += cache.get(ch);
  }
  return totalWidth;
}

/**
 * 纯算术换行：根据最大宽度切分文本为行
 */
function 布局文本(text, font, maxWidth) {
  const ctx = 获取测量上下文();
  ctx.font = font;

  if (!宽度缓存.has(font)) 宽度缓存.set(font, new Map());
  const cache = 宽度缓存.get(font);

  const lines = [];
  let currentLine = '';
  let currentWidth = 0;

  for (const ch of text) {
    if (ch === '\n') {
      lines.push({ text: currentLine, width: currentWidth });
      currentLine = '';
      currentWidth = 0;
      continue;
    }

    if (!cache.has(ch)) cache.set(ch, ctx.measureText(ch).width);
    const charW = cache.get(ch);

    if (currentWidth + charW > maxWidth && currentLine.length > 0) {
      lines.push({ text: currentLine, width: currentWidth });
      currentLine = ch;
      currentWidth = charW;
    } else {
      currentLine += ch;
      currentWidth += charW;
    }
  }

  if (currentLine) lines.push({ text: currentLine, width: currentWidth });
  return lines;
}

// ===== 战报面板 =====

export class 战报面板 {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.entries = []; // { text, color, tick }
    this.maxEntries = 50;
    this.scrollOffset = 0;
    this.font = '12px "Courier New", monospace';
    this.lineHeight = 16;
    this.padding = 8;

    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.innerHTML = '<h3>战报</h3>';
    container.appendChild(this.canvas);

    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);

    // 滚轮滚动
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scrollOffset = Math.max(0, this.scrollOffset + Math.sign(e.deltaY) * 3);
      this.渲染();
    });
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width - 4;
    this.canvas.height = rect.height - 30;
    this.渲染();
  }

  添加(text, color = '#999', tick = 0) {
    this.entries.push({ text, color, tick });
    if (this.entries.length > this.maxEntries) this.entries.shift();
    // 自动滚动到底部
    this.scrollOffset = Math.max(0, this._totalLines() - this._visibleLines());
    this.渲染();
  }

  _totalLines() {
    const maxW = this.canvas.width - this.padding * 2;
    let count = 0;
    for (const entry of this.entries) {
      count += 布局文本(`[${entry.tick}] ${entry.text}`, this.font, maxW).length;
    }
    return count;
  }

  _visibleLines() {
    return Math.floor((this.canvas.height - this.padding) / this.lineHeight);
  }

  渲染() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    ctx.font = this.font;
    ctx.textBaseline = 'top';

    const maxW = w - this.padding * 2;
    let allLines = [];

    for (const entry of this.entries) {
      const lines = 布局文本(`[${entry.tick}] ${entry.text}`, this.font, maxW);
      for (const line of lines) {
        allLines.push({ ...line, color: entry.color });
      }
    }

    // 应用滚动偏移
    const startLine = Math.min(this.scrollOffset, Math.max(0, allLines.length - this._visibleLines()));
    const visibleCount = this._visibleLines();

    let y = this.padding;
    for (let i = startLine; i < Math.min(allLines.length, startLine + visibleCount); i++) {
      ctx.fillStyle = allLines[i].color;
      ctx.fillText(allLines[i].text, this.padding, y);
      y += this.lineHeight;
    }

    // 滚动条指示
    if (allLines.length > visibleCount) {
      const ratio = startLine / (allLines.length - visibleCount);
      const barH = Math.max(20, h * visibleCount / allLines.length);
      const barY = ratio * (h - barH);
      ctx.fillStyle = '#333';
      ctx.fillRect(w - 4, barY, 3, barH);
    }
  }
}

// ===== 玩家状态总览面板 =====

export class 状态总览面板 {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.状态 = null;
    this.mySlot = -1;

    container.appendChild(this.canvas);
    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  更新(状态, mySlot) {
    this.状态 = 状态;
    this.mySlot = mySlot;
    this.渲染();
  }

  渲染() {
    const ctx = this.ctx;
    const 状态 = this.状态;
    if (!状态) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, w, h);

    const 玩家颜色 = [
      '#FF4444', '#4488FF', '#44FF44', '#FFFF44',
      '#FF44FF', '#44FFFF', '#FF8844', '#FFFFFF',
    ];

    const rowH = 44;
    const padding = 6;

    ctx.textBaseline = 'middle';

    for (let i = 0; i < 状态.段落.length; i++) {
      const 段 = 状态.段落[i];
      const y = padding + i * rowH;
      const isMe = i === this.mySlot;

      // 背景
      if (isMe) {
        ctx.fillStyle = '#1a2a1a';
        ctx.fillRect(0, y, w, rowH - 2);
      }

      // 玩家名
      ctx.font = isMe ? 'bold 12px monospace' : '12px monospace';
      ctx.fillStyle = 段.存活 ? 玩家颜色[i] : '#444';
      const nameText = `${isMe ? '▶' : ' '}${段.用户名 || 'P' + i}`;
      ctx.fillText(nameText, padding, y + 10);

      if (!段.存活) {
        ctx.fillStyle = '#444';
        ctx.font = '11px monospace';
        ctx.fillText('☠ 已淘汰', padding, y + 28);
        continue;
      }

      // HP 条
      const barX = padding;
      const barY = y + 20;
      const barW = w - padding * 2;
      const barH = 6;

      ctx.fillStyle = '#222';
      ctx.fillRect(barX, barY, barW, barH);

      const hpRatio = (段.基地HP || 0) / (段.最大HP || 100);
      ctx.fillStyle = hpRatio > 0.6 ? '#4a4' : hpRatio > 0.3 ? '#aa4' : '#c33';
      ctx.fillRect(barX, barY, barW * hpRatio, barH);

      // 数值
      ctx.font = '10px monospace';
      ctx.fillStyle = '#aaa';
      ctx.fillText(`♥${段.基地HP} 💰${段.资源} 🏗${(段.塔台 || []).length} 👾${(段.单位 || []).length}`, padding, y + 36);
    }
  }
}

// ===== 通知浮字系统 =====

export class 通知系统 {
  constructor(container) {
    this.container = container;
    this.notifications = [];
  }

  显示(text, type = 'info') {
    const el = document.createElement('div');
    el.className = `notification notification-${type}`;
    el.textContent = text;
    this.container.appendChild(el);

    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 500);
    }, 2500);
  }
}
