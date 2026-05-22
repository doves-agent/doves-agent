/**
 * @file 导入工具-定义.js
 * @description 词汇导入工具定义：OCR识别、视频识别、手动录入、发布、我的词库
 */

export const importTools = [
  {
    name: 'word_import_ocr',
    description: '通过图片OCR识别英文单词并录入用户私有词库。支持课本拍照、单词表截图等场景。',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: '图片URL或base64 data URI（必填）' },
        category: { type: 'string', description: '单词分类：小学/初中/高中/四级/六级/日常用语/科技/商务/医学/custom', enum: ['小学', '初中', '高中', '四级', '六级', '日常用语', '科技', '商务', '医学', 'custom'] },
        category_custom: { type: 'string', description: '自定义分类名（category为custom时使用）' },
      },
      required: ['image_url']
    },
  },
  {
    name: 'word_import_video',
    description: '通过视频识别英文单词并录入用户私有词库。从视频字幕/对话中提取英语单词。',
    inputSchema: {
      type: 'object',
      properties: {
        video_url: { type: 'string', description: '视频URL或文件路径（必填）' },
        category: { type: 'string', description: '单词分类：小学/初中/高中/四级/六级/日常用语/科技/商务/医学/custom', enum: ['小学', '初中', '高中', '四级', '六级', '日常用语', '科技', '商务', '医学', 'custom'] },
        category_custom: { type: 'string', description: '自定义分类名（category为custom时使用）' },
      },
      required: ['video_url']
    },
  },
  {
    name: 'word_import_manual',
    description: '手动录入单词到私有词库，AI自动辅助填充空字段（音标/词根/释义等）。用户至少需要提供word和category。',
    inputSchema: {
      type: 'object',
      properties: {
        word: { type: 'string', description: '要录入的英文单词（必填）' },
        category: { type: 'string', description: '单词分类（必填）：小学/初中/高中/四级/六级/日常用语/科技/商务/医学/custom', enum: ['小学', '初中', '高中', '四级', '六级', '日常用语', '科技', '商务', '医学', 'custom'] },
        category_custom: { type: 'string', description: '自定义分类名（category为custom时使用）' },
        phonetic: { type: 'string', description: '音标（可选，AI可自动填充）' },
        definitions: { type: 'array', description: '释义列表（可选，AI可自动填充）', items: { type: 'object' } },
        roots: { type: 'object', description: '词根词缀（可选，AI可自动填充）' },
        syllables: { type: 'array', description: '音节（可选，AI可自动填充）' },
        synonyms: { type: 'array', description: '同义词', items: { type: 'string' } },
        antonyms: { type: 'array', description: '反义词', items: { type: 'string' } },
        phrases: { type: 'array', description: '短语/例句', items: { type: 'object' } },
      },
      required: ['word', 'category']
    },
  },
  {
    name: 'word_publish',
    description: '管理员将私有词库中的单词发布到公共词库。需要管理员权限。支持单个或批量发布。',
    inputSchema: {
      type: 'object',
      properties: {
        word_id: { type: 'string', description: '单个单词ID' },
        word_ids: { type: 'array', description: '批量单词ID数组', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'word_list_mine',
    description: '查看当前用户的私有词库，按分类分组展示。可按分类筛选和分页。',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '按分类筛选' },
        page: { type: 'number', description: '页码（默认1）' },
        limit: { type: 'number', description: '每页数量（默认20）' },
      },
    },
  },
];
