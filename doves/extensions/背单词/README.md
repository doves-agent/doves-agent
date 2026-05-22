# 背单词 - 词汇学习扩展包 v2

AI 原生词汇学习系统，零外部依赖，通过 DoveAppContext 接口底座直连数据库。

## 概览

| 项目 | 说明 |
|------|------|
| 版本 | 2.0.0 |
| 能力 | 词汇学习、单词记忆、间隔复习、智能推荐 |
| 依赖 | 无（通过 DoveAppContext 访问数据） |
| 数据库 | MongoDB（背单词 库：words / learningrecords / colortemplates） |
| Web 页面 | 学习 / 复习 / 录入 / 统计 / 预览（自动注入 CLI Web 侧边栏） |

## 架构

```
LLM 层（意图/策略/角色/执行器）
    │
    ▼
服务层（SM2 算法 / 画像 / 推荐 / OCR）
    │
    ▼
数据层（words.js / records.js / colors.js / imports.js）
    │
    ▼
DoveAppContext（ctx.db → 受控代理 → DovesProxy → 加密TCP → Server → MongoDB）
```

```
背单词/
├── manifest.js          # 扩展包声明（权限/页面/钩子）
├── intent.js            # 意图定义：learning / review / navigate
├── strategy.js          # 规划策略：学习→direct / 复习→pipeline / 导航→direct
├── roles.js             # 角色：vocabulary_tutor（词汇导师）
├── review.js            # 安全审核规则
├── execution.js         # 执行器条件注入（教学指引）
├── workflow.js          # 能力组 + 流程案例声明
├── data/
│   ├── words.js         # 单词数据层（shared scope）
│   ├── records.js       # 学习记录数据层（user_scoped）
│   ├── colors.js        # 颜色模板数据层
│   └── imports.js       # 导入数据层
├── services/
│   ├── sm2.js           # SM-2 算法（re-export @dove/common/sm2-算法.js）
│   ├── profile.js       # 用户学习画像
│   ├── recommender.js   # 智能推荐引擎
│   └── ocr识别.js       # OCR/视觉/AI填充
├── skills/
│   └── vocabulary_review/index.js   # SM2 复习技能
├── tools/
│   ├── _词汇工具-定义.js  # 11 个词汇工具定义
│   ├── _导入工具-定义.js  # 5 个导入工具定义
│   ├── 词汇工具.js       # 词汇工具处理器
│   └── 导入工具.js       # 导入工具处理器
└── web/
    ├── learn.html       # 学习页面（查词 + 彩色渲染 + 词根拆解）
    ├── review.html      # 复习页面（SM2 间隔 + 三档反馈）
    ├── import.html      # 录入页面（手动/OCR/视频/我的词库）
    ├── stats.html       # 统计页面（指标 + 画像 + 推荐）
    ├── preview.html     # 预览页面（渲染效果 + 单元测试）
    └── vocab-common.js  # 共享渲染逻辑和 API 层
```

## 数据库 Schema

数据库名：`背单词`

| 集合 | Scope | 描述 |
|------|-------|------|
| `words` | shared | 单词库（全局共享，word 唯一索引） |
| `learningrecords` | user_scoped (user_id) | 学习记录（按用户隔离） |
| `colortemplates` | shared | 颜色模板（系统预设 + 用户自定义） |

### words 文档结构

```json
{
  "word": "elaborate",
  "phonetic": "/ɪˈlæb.ər.ət/",
  "syllables": [{ "text": "e", "stress": false }, ...],
  "roots": { "prefix": "e", "root": "labor", "suffix": "ate", "explanation": "..." },
  "vowel_segments": [{ "text": "e", "is_vowel": true }, ...],
  "definitions": [{ "pos": "adj.", "definition": "...", "meaning_cn": "...", "examples": [...] }],
  "related_words": [], "synonyms": [], "antonyms": [], "phrases": [],
  "difficulty_level": 5,
  "tags": [], "source": "manual|ai_generated|ocr|video",
  "scope": "public|user_xxx",
  "status": "public|private|pending_review"
}
```

### learningrecords 文档结构

```json
{
  "user_id": "user_abc",
  "word_id": "ObjectId(words._id)",
  "stage": "learning|reviewing|mastered",
  "review_info": {
    "ease_factor": 2.5,
    "interval_days": 6,
    "repetition_count": 2,
    "next_review_date": "2026-05-25T00:00:00Z",
    "familiarity": 0.4,
    "memory_stability": 0.02
  },
  "stats": { "correct_count": 3, "incorrect_count": 1, "total_count": 4, "accuracy_rate": 0.75 }
}
```

## 工具列表（16 个）

### 词汇工具（11 个）

| 工具名 | 安全级别 | 功能 |
|--------|---------|------|
| `word_query` | 安全 | 查询单词详情（音标/词根/释义/例句） |
| `word_learn` | 谨慎 | 记录学习结果（创建/更新 SM2 记录） |
| `word_review_list` | 安全 | 获取今日待复习单词（SM2 到期筛选） |
| `word_review_submit` | 谨慎 | 提交复习反馈（SM2 重新计算间隔） |
| `learning_stats` | 安全 | 学习统计 + 画像 |
| `smart_recommend` | 安全 | 智能推荐新词（基于词根掌握度/难度） |
| `word_generate` | 谨慎 | AI 生成单词数据并入库（两阶段：模板→入库） |
| `color_template_list` | 安全 | 列出颜色模板 |
| `color_template_create` | 谨慎 | 创建自定义颜色模板 |
| `color_template_delete` | 谨慎 | 删除自定义颜色模板 |
| `open_vocabulary_page` | 安全 | 打开/列出背单词 Web 页面 |

### 导入工具（5 个）

| 工具名 | 安全级别 | 功能 |
|--------|---------|------|
| `word_import_ocr` | 谨慎 | 图片 OCR 识别导入 |
| `word_import_video` | 谨慎 | 视频文本提取导入 |
| `word_import_manual` | 谨慎 | 手动录入 + AI 辅助填充 |
| `word_publish` | 谨慎 | 发布私有单词到公共库 |
| `word_list_mine` | 安全 | 查看用户私有词库 |

## 意图识别

| 意图 | 执行模式 | 触发关键词 |
|------|---------|-----------|
| `vocabulary_learning` | 直接执行 | 背单词、学单词、查词、词根、什么意思、怎么读... |
| `vocabulary_review` | 管线式 | 复习、间隔复习、推荐、学习统计、掌握度... |
| `vocabulary_navigate` | 直接执行 | 打开背单词、打开学习页面、打开复习页面... |

## SM-2 算法

共享实现位于 `@dove/common/sm2-算法.js`。

反馈等级映射：
- unknown/again → quality=1（完全不认识）
- vague → quality=2（模糊）
- hard → quality=3（费力但能想起）
- good → quality=4（认识）
- known/easy → quality=5（非常熟悉）

阶段流转：
- `learning` → 初始/重置
- `reviewing` → repetition_count >= 2
- `mastered` → repetition_count >= 5 且 ease_factor >= 2.0 且 interval_days >= 30

## 推荐策略

`services/recommender.js` 使用 4 策略逐级补充：

1. **词根聚焦** — 指定聚焦词根时，查找共享该词根的未学单词
2. **词根扩展** — 从用户 top-3 已掌握词根中扩展关联词
3. **难度递进** — 在 [当前最高难度 - 2, 当前最高难度 + delta] 范围内筛选
4. **随机补充** — 填充剩余名额

所有策略均自动排除已学单词（通过 `$nin` 查询），使用数据库索引高效筛选。

## Web 页面

通过 `manifest.web` 声明，CLI Web 启动时自动注入侧边栏：

| 页面ID | 标题 | 功能 |
|--------|------|------|
| `vocabulary-learn` | 学习 | 查词 + 彩色渲染（音节/词根/元音）+ 词根拆解 + 学习记录 |
| `vocabulary-review` | 复习 | SM2 到期词 + 显示/隐藏释义 + 三档反馈 |
| `vocabulary-import` | 录入 | 手动录入/图片OCR/视频文本/我的词库 |
| `vocabulary-stats` | 统计 | 六项指标 + 学习画像 + 智能推荐 |
| `vocabulary-preview` | 预览 | 渲染效果展示 + 模拟数据 + 单元测试 |

页面通过 `DoveSDK.callTool()` 与白鸽通信，走任务队列。

## 角色

`vocabulary_tutor`（词汇导师）：
- 词根优先：先拆解词根词缀再给释义
- 关联已知：主动关联学生已掌握的词根/单词
- 难度适配：根据学生水平调整解释深度
- 例句驱动：每个重要释义至少一个地道例句
- 及时记录：教学后 word_learn 记录，保持记忆曲线
