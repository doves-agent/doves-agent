/**
 * 词汇公共模块 - Web 页面共享的渲染逻辑、API调用、颜色模板管理
 * 
 * 使用方式：在 HTML 中 <script src="vocab-common.js"></script>
 * 所有工具调用通过 DoveSDK 统一接口，扩展页面禁止直接访问 DoveEngine
 */

// ==================== API 层 ====================

const VocAPI = {
  /**
   * 调用扩展工具（通过 DoveSDK.callTool() 统一接口）
   * DoveSDK 自动管理认证、结果解包、同步/异步双路径
   * @param {string} tool - 工具名称
   * @param {Object} args - 工具参数
   * @returns {Promise<Object>} 工具返回数据（已解包）
   */
  async call(tool, args = {}) {
    if (!window.DoveSDK) {
      throw new Error('DoveSDK 不可用，请在白鸽 Web 环境中使用');
    }
    const result = await DoveSDK.callTool(tool, args, { extension: '背单词' });
    if (!result.success) {
      throw new Error(result.error || '工具调用失败');
    }
    return result.data;
  },

  // 便捷方法
  queryWord(word) { return this.call('word_query', { word }); },
  learnWord(word_id, correct, time_spent = 5) { return this.call('word_learn', { word_id, correct, time_spent }); },
  reviewList(limit = 20) { return this.call('word_review_list', { limit }); },
  reviewSubmit(record_id, feedback) { return this.call('word_review_submit', { record_id, feedback }); },
  learningStats() { return this.call('learning_stats', {}); },
  smartRecommend(count = 5) { return this.call('smart_recommend', { count }); },
  generateWord(word) { return this.call('word_generate', { word }); },
  listColorTemplates() { return this.call('color_template_list', {}); },
  createColorTemplate(name, colors) { return this.call('color_template_create', { name, colors }); },
  deleteColorTemplate(templateId) { return this.call('color_template_delete', { templateId }); },
  // 导入工具
  importOCR(image_url, category) { return this.call('word_import_ocr', { image_url, category }); },
  importVideo(video_url, category) { return this.call('word_import_video', { video_url, category }); },
  importManual(args) { return this.call('word_import_manual', args); },
  publishWord(word_id) { return this.call('word_publish', { word_id }); },
  listMyWords(args = {}) { return this.call('word_list_mine', args); },
};

// ==================== 颜色模板管理 ====================

const VocTemplates = {
  templates: [],
  currentTemplate: null,

  /** 默认配色 */
  defaultColors: ['#DC2626', '#0D9488', '#2563EB', '#059669', '#D97706'],

  getColors() {
    return this.currentTemplate?.colors || this.defaultColors;
  },

  async load(selectElementId, previewElementId, onApply) {
    this._onApply = onApply;
    try {
      const result = await VocAPI.listColorTemplates();
      // 适配不同返回格式
      let list = [];
      if (Array.isArray(result)) {
        list = result;
      } else if (result?.templates) {
        list = result.templates;
      } else if (result?.data?.templates) {
        list = result.data.templates;
      }
      // 格式化
      this.templates = list.map(t => ({
        id: t.id || t._id,
        name: t.name,
        colors: t.colors,
        isSystem: t.isSystem || t.type === 'system',
      }));
    } catch (e) {
      console.warn('[VocTemplates] 加载颜色模板失败:', e);
      this.templates = [];
    }

    // 渲染 select
    const select = document.getElementById(selectElementId);
    if (select) {
      select.innerHTML = this.templates.map((t, i) =>
        `<option value="${i}">${t.name}${t.isSystem ? '' : ' ★'}</option>`
      ).join('');
      select.onchange = () => this.apply(select.selectedIndex, previewElementId);
    }

    this.apply(0, previewElementId);
  },

  apply(index, previewElementId) {
    if (!this.templates[index]) return;
    this.currentTemplate = this.templates[index];
    const colors = this.currentTemplate.colors;

    // 更新 CSS 变量
    const root = document.documentElement;
    colors.forEach((c, i) => root.style.setProperty(`--color-${i + 1}`, c));

    // 更新颜色预览
    const preview = document.getElementById(previewElementId);
    if (preview) {
      preview.innerHTML = colors.map(c =>
        `<span class="color-dot" style="background:${c}"></span>`
      ).join('');
    }

    // 回调
    if (this._onApply) this._onApply();
  },
};

// ==================== 彩色渲染核心 ====================

const VocRender = {
  /**
   * 渲染彩色单词
   * @param {Object} wordData - { word, syllables, roots, vowel_segments }
   * @param {string} mode - 'syllable' | 'root' | 'vowel'
   * @param {string[]} [colors] - 颜色数组
   * @returns {string} HTML
   */
  coloredWord(wordData, mode, colors) {
    if (!wordData) return '';
    const c = colors || VocTemplates.getColors();

    switch (mode) {
      case 'syllable': return this._renderSyllable(wordData, c);
      case 'root': return this._renderRoot(wordData, c);
      case 'vowel': return this._renderVowel(wordData, c);
      default: return `<span style="color:${c[0]}">${wordData.word}</span>`;
    }
  },

  _renderSyllable(wordData, c) {
    if (wordData.syllables && wordData.syllables.length > 0) {
      const syllableTexts = wordData.syllables.map(s => typeof s === 'object' ? s.text : s);
      const joined = syllableTexts.join('').replace(/-/g, '').toLowerCase();
      const original = (wordData.word || '').replace(/-/g, '').toLowerCase();
      if (joined !== original) {
        return `<span style="color:${c[0]}">${wordData.word}</span>`;
      }
      return wordData.syllables.map((syl, i) => {
        const text = typeof syl === 'object' ? syl.text : syl;
        const isStress = typeof syl === 'object' && (syl.stress === true || syl.stress === 'true' || syl.stress === 1);
        return `<span style="color:${c[i % c.length]};font-weight:${isStress ? '700' : '400'}">${text}</span>`;
      }).join('');
    }
    return `<span style="color:${c[0]}">${wordData.word}</span>`;
  },

  _renderRoot(wordData, c) {
    if (wordData.roots) {
      const prefix = (wordData.roots.prefix || '').replace(/-/g, '');
      const root = (wordData.roots.root || '').replace(/-/g, '');
      const suffix = (wordData.roots.suffix || '').replace(/-/g, '');
      const combined = prefix + root + suffix;
      const original = (wordData.word || '').replace(/-/g, '');

      const parts = [];
      if (combined.toLowerCase() === original.toLowerCase()) {
        if (prefix) parts.push({ text: prefix, ci: 0 });
        if (root) parts.push({ text: root, ci: 1 });
        if (suffix) parts.push({ text: suffix, ci: 2 });
      } else {
        // 智能匹配
        let remaining = original.toLowerCase();
        let idx = 0;
        if (prefix) {
          const pLow = prefix.toLowerCase();
          if (remaining.startsWith(pLow)) {
            parts.push({ text: wordData.word.substring(idx, idx + prefix.length), ci: 0 });
            remaining = remaining.substring(prefix.length);
            idx += prefix.length;
          }
        }
        if (root) {
          const rLow = root.toLowerCase();
          const rIdx = remaining.indexOf(rLow);
          if (rIdx !== -1) {
            if (rIdx > 0) parts.push({ text: wordData.word.substring(idx, idx + rIdx), ci: 0 });
            parts.push({ text: wordData.word.substring(idx + rIdx, idx + rIdx + root.length), ci: 1 });
            remaining = remaining.substring(rIdx + root.length);
            idx += rIdx + root.length;
          }
        }
        if (suffix) {
          const sLow = suffix.toLowerCase();
          if (remaining.endsWith(sLow)) {
            const sStart = remaining.length - suffix.length;
            if (sStart > 0) parts.push({ text: wordData.word.substring(idx, idx + sStart), ci: 1 });
            parts.push({ text: wordData.word.substring(idx + sStart, idx + sStart + suffix.length), ci: 2 });
            remaining = '';
          }
        }
        if (remaining) parts.push({ text: wordData.word.substring(idx), ci: 2 });
      }
      if (parts.length > 0) {
        return parts.map(p => `<span style="color:${c[p.ci % c.length]}">${p.text}</span>`).join('');
      }
    }
    return `<span style="color:${c[0]}">${wordData.word}</span>`;
  },

  _renderVowel(wordData, c) {
    if (wordData.vowel_segments && wordData.vowel_segments.length > 0) {
      const segTexts = wordData.vowel_segments.map(v => typeof v === 'object' ? v.text : v);
      const joined = segTexts.join('').toLowerCase();
      const original = (wordData.word || '').toLowerCase();
      if (joined !== original) {
        return this._localVowelSegments(wordData.word, c);
      }
      return wordData.vowel_segments.map(seg => {
        const isVowel = typeof seg === 'object' && (seg.is_vowel === true || seg.is_vowel === 'true' || seg.is_vowel === 1);
        const text = typeof seg === 'object' ? seg.text : seg;
        return `<span style="color:${isVowel ? c[0] : (c[2] || c[1])}">${text}</span>`;
      }).join('');
    }
    return this._localVowelSegments(wordData.word, c);
  },

  /** 本地元音/辅音分段（fallback） */
  _localVowelSegments(word, c) {
    const vowels = 'aeiouAEIOU';
    const segments = [];
    let current = '';
    let currentIsVowel = null;
    for (const char of word) {
      const isV = vowels.includes(char);
      if (currentIsVowel === null) { currentIsVowel = isV; current = char; }
      else if (currentIsVowel === isV) { current += char; }
      else { segments.push({ text: current, is_vowel: currentIsVowel }); current = char; currentIsVowel = isV; }
    }
    if (current) segments.push({ text: current, is_vowel: currentIsVowel });
    if (segments.length === 0) return `<span style="color:${c[0]}">${word}</span>`;
    return segments.map(seg => {
      const color = seg.is_vowel ? c[0] : (c[2] || c[1]);
      return `<span style="color:${color}">${seg.text}</span>`;
    }).join('');
  },

  /**
   * 渲染彩色音标
   */
  coloredPhonetic(phonetic, wordData, mode, colors) {
    if (!phonetic) return '';
    const c = colors || VocTemplates.getColors();
    let clean = phonetic.replace(/^[/\[]|[/\]]$/g, '');

    if (mode === 'syllable') {
      const syllables = clean.split('.');
      if (syllables.length <= 1) {
        const parts = clean.split(/(?=[ˈˌ])/);
        if (parts.length > 1) return '/' + parts.map((s, i) => `<span style="color:${c[i % c.length]}">${s}</span>`).join('.') + '/';
        return `/<span style="color:${c[0]}">${clean}</span>/`;
      }
      return '/' + syllables.map((s, i) => `<span style="color:${c[i % c.length]}">${s}</span>`).join('.') + '/';
    }

    if (mode === 'root') {
      const parts = clean.split('.');
      const numRootParts = [wordData?.roots?.prefix, wordData?.roots?.root, wordData?.roots?.suffix].filter(Boolean).length || 1;
      if (parts.length >= numRootParts && numRootParts > 1) {
        const perGroup = Math.ceil(parts.length / numRootParts);
        let html = '/'; let ci = 0;
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) html += '.';
          if (i > 0 && i % perGroup === 0) ci++;
          html += `<span style="color:${c[ci % c.length]}">${parts[i]}</span>`;
        }
        return html + '/';
      }
      return `/<span style="color:${c[0]}">${clean}</span>/`;
    }

    if (mode === 'vowel') {
      const vowelChars = 'aeiouæɑɒɔəɛɪʊʌɜɐøœɨʉɯɤɵʏ';
      let html = '/';
      for (const char of clean) {
        if (char === '.' || char === 'ˈ' || char === 'ˌ') { html += char; }
        else if (vowelChars.includes(char.toLowerCase())) { html += `<span style="color:${c[0]}">${char}</span>`; }
        else { html += `<span style="color:${c[2] || c[1]}">${char}</span>`; }
      }
      return html + '/';
    }

    return phonetic;
  },

  /**
   * 渲染图例
   * @returns {string} HTML
   */
  legend(wordData, mode) {
    const c = VocTemplates.getColors();
    let items = [];
    if (mode === 'syllable' && wordData.syllables) {
      wordData.syllables.forEach((syl, i) => {
        const text = typeof syl === 'object' ? syl.text : syl;
        const isStress = typeof syl === 'object' && (syl.stress === true || syl.stress === 'true' || syl.stress === 1);
        items.push(`<span class="legend-item"><span class="legend-dot" style="background:${c[i % c.length]}"></span>${text}${isStress ? ' (重)' : ''}</span>`);
      });
    } else if (mode === 'root' && wordData.roots) {
      if (wordData.roots.prefix) items.push(`<span class="legend-item"><span class="legend-dot" style="background:${c[0]}"></span>前缀: ${wordData.roots.prefix}</span>`);
      if (wordData.roots.root) items.push(`<span class="legend-item"><span class="legend-dot" style="background:${c[1]}"></span>词根: ${wordData.roots.root}</span>`);
      if (wordData.roots.suffix) items.push(`<span class="legend-item"><span class="legend-dot" style="background:${c[2]}"></span>后缀: ${wordData.roots.suffix}</span>`);
    } else if (mode === 'vowel') {
      items.push(`<span class="legend-item"><span class="legend-dot" style="background:${c[0]}"></span>元音</span>`);
      items.push(`<span class="legend-item"><span class="legend-dot" style="background:${c[2] || c[1]}"></span>辅音</span>`);
    }
    return items.length > 0 ? `<div class="legend">${items.join('')}</div>` : '';
  },

  /**
   * 渲染词根词缀区
   */
  rootsSection(wordData) {
    if (!wordData.roots || (!wordData.roots.prefix && !wordData.roots.root && !wordData.roots.suffix)) return '';
    const c = VocTemplates.getColors();
    let html = '<div class="roots-section">';
    html += '<div class="roots-title">词根词缀拆解</div>';
    html += '<div class="roots-parts">';
    if (wordData.roots.prefix) html += `<span class="roots-part" style="background:${c[0]}22;color:${c[0]}">${wordData.roots.prefix}</span>`;
    if (wordData.roots.root) html += `<span class="roots-part" style="background:${c[1]}22;color:${c[1]}">${wordData.roots.root}</span>`;
    if (wordData.roots.suffix) html += `<span class="roots-part" style="background:${c[2]}22;color:${c[2]}">${wordData.roots.suffix}</span>`;
    html += '</div>';
    if (wordData.roots.explanation) html += `<div class="roots-explanation">${wordData.roots.explanation}</div>`;
    html += '</div>';
    return html;
  },

  /**
   * 渲染释义列表
   */
  definitions(defs) {
    if (!defs || defs.length === 0) return '';
    let html = '<div class="definitions">';
    for (const def of defs) {
      html += `<div class="definition"><span class="pos">${def.pos || def.partOfSpeech || ''}</span><span class="meaning">${def.meaning_cn || def.meaning || def.definition || ''}</span>`;
      if (def.example) html += `<div class="example">${def.example}</div>`;
      html += '</div>';
    }
    html += '</div>';
    return html;
  },

  /**
   * 渲染关联词标签
   */
  relatedTags(title, words, onClickQuery) {
    if (!words || words.length === 0) return '';
    const onclick = onClickQuery || '';
    let html = `<div class="related-section"><div class="related-title">${title}</div><div class="related-tags">`;
    for (const w of words) {
      if (onclick) {
        html += `<span class="related-tag" onclick="${onclick}('${w}')">${w}</span>`;
      } else {
        html += `<span class="related-tag">${w}</span>`;
      }
    }
    html += '</div></div>';
    return html;
  },
};

// ==================== 公共 CSS（所有页面共享的基础样式） ====================

const VocCommonCSS = `
  :root {
    --color-1: #DC2626;
    --color-2: #0D9488;
    --color-3: #2563EB;
    --color-4: #059669;
    --color-5: #D97706;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; background: #fafafa; color: #333; }
  h2 { margin-bottom: 16px; font-size: 18px; }

  /* 工具栏 */
  .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; padding: 12px 16px; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .toolbar label { font-size: 13px; color: #666; font-weight: 600; }
  .mode-btns { display: flex; gap: 4px; }
  .mode-btns button { padding: 5px 14px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer; font-size: 13px; color: #555; transition: all 0.2s; }
  .mode-btns button.active { background: #3498db; color: #fff; border-color: #3498db; }
  .mode-btns button:hover:not(.active) { border-color: #3498db; color: #3498db; }
  .template-select { padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; outline: none; cursor: pointer; }
  .template-select:focus { border-color: #3498db; }
  .color-preview { display: flex; gap: 3px; align-items: center; }
  .color-dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.1); }

  /* 图例 */
  .legend { display: flex; gap: 12px; justify-content: center; margin-bottom: 12px; flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #666; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; }

  /* 词根词缀区 */
  .roots-section { background: #eaf6ff; padding: 12px 16px; border-radius: 8px; margin-bottom: 14px; }
  .roots-section .roots-title { font-size: 13px; color: #2980b9; font-weight: 600; margin-bottom: 6px; }
  .roots-parts { display: flex; gap: 6px; flex-wrap: wrap; }
  .roots-part { padding: 4px 12px; border-radius: 4px; font-size: 15px; font-weight: 600; }
  .roots-explanation { font-size: 13px; color: #555; margin-top: 6px; }

  /* 释义 */
  .definitions { margin-top: 14px; }
  .definition { margin-bottom: 8px; padding-left: 12px; border-left: 3px solid #3498db; }
  .definition .pos { font-weight: 600; color: #e74c3c; margin-right: 6px; font-size: 13px; }
  .definition .meaning { font-size: 15px; }
  .definition .example { font-size: 13px; color: #7f8c8d; margin-top: 2px; font-style: italic; }

  /* 关联词 */
  .related-section { margin-top: 14px; }
  .related-title { font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px; }
  .related-tags { display: flex; gap: 6px; flex-wrap: wrap; }
  .related-tag { padding: 3px 10px; background: #f0f0f0; border-radius: 12px; font-size: 13px; color: #555; cursor: pointer; transition: background 0.15s; }
  .related-tag:hover { background: #e0e0e0; }

  /* 短语 */
  .phrase { font-size: 13px; color: #555; margin: 4px 0; }
  .phrase em { font-style: italic; color: #3498db; }

  /* 通用状态 */
  .empty { text-align: center; color: #999; padding: 40px 20px; }
  .error { color: #e74c3c; padding: 12px; background: #ffeaea; border-radius: 6px; }
  .loading { text-align: center; color: #999; padding: 20px; }

  /* 导航栏 */
  .page-nav { display: flex; gap: 4px; margin-bottom: 16px; background: #fff; border-radius: 8px; padding: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .page-nav a { padding: 6px 16px; border-radius: 6px; font-size: 13px; color: #666; text-decoration: none; transition: all 0.15s; }
  .page-nav a:hover { background: #f0f0f0; color: #333; }
  .page-nav a.active { background: #3498db; color: #fff; }
`;
