/**
 * 文档管理 - 工具定义
 * 文档类型、来源和工具Schema定义
 */

// 支持的文档类型
export const DOC_TYPES = {
  TXT: 'txt',
  MD: 'md',
  JSON: 'json',
  CSV: 'csv',
  PDF: 'pdf',
  DOCX: 'docx',
  XLSX: 'xlsx',
  PPTX: 'pptx',
  HTML: 'html',
  XML: 'xml',
};

// 文档来源
export const DOC_SOURCES = {
  LOCAL: 'local',
  UPLOAD: 'upload',
  DATABASE: 'database',
};

// 文档工具定义
export const documentTools = [
  {
    name: '文档读取',
    description: '读取文档内容。[限制]PDF提取依赖pdf-parse库，未安装则无法读取；DOCX/PPTX提取为纯文本，丢失排版和图片。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: Object.values(DOC_SOURCES), description: '文档来源：local(本地)、upload(上传)、database(数据库)' },
        path: { type: 'string', description: '文件路径或 hashId' },
        documentId: { type: 'string', description: '文档ID（database时必填）' },
        conversationId: { type: 'string', description: '对话ID（upload时可选）' },
        encoding: { type: 'string', description: '文件编码', default: 'utf-8' },
        maxSize: { type: 'number', description: '最大读取字节数', default: 10485760 },
      },
      required: ['source'],
    },
  },
  {
    name: '文档搜索',
    description: '在文档中搜索内容。支持本地目录、上传文件、数据库文档的全文搜索。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        source: { type: 'string', enum: Object.values(DOC_SOURCES), description: '搜索范围' },
        path: { type: 'string', description: '搜索路径（local时）' },
        conversationId: { type: 'string', description: '对话ID（upload时）' },
        fileTypes: { type: 'array', items: { type: 'string' }, description: '文件类型过滤' },
        limit: { type: 'number', description: '返回结果数量限制', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: '文档列表',
    description: '列出文档列表。支持列出本地目录、上传文件、数据库文档。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: Object.values(DOC_SOURCES), description: '文档来源' },
        path: { type: 'string', description: '目录路径（local时）' },
        conversationId: { type: 'string', description: '对话ID（upload时）' },
        fileTypes: { type: 'array', items: { type: 'string' }, description: '文件类型过滤' },
        recursive: { type: 'boolean', description: '是否递归列出子目录', default: false },
        limit: { type: 'number', description: '返回数量限制', default: 50 },
      },
      required: ['source'],
    },
  },
  {
    name: '文档信息',
    description: '获取文档详细信息（大小、类型、创建时间等）',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: Object.values(DOC_SOURCES), description: '文档来源' },
        path: { type: 'string', description: '文件路径（local/upload时）' },
        documentId: { type: 'string', description: '文档ID（database时）' },
        conversationId: { type: 'string', description: '对话ID（upload时）' },
      },
      required: ['source'],
    },
  },
  {
    name: '文档保存',
    description: '保存文档到数据库。[限制]仅保存纯文本内容到MongoDB，不支持生成PDF/PPT/DOCX等格式化文件。需要生成文档请使用其他工具或执行命令调用本地程序。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '文档名称' },
        content: { type: 'string', description: '文档内容' },
        type: { type: 'string', description: '文档类型' },
        userId: { type: 'string', description: '用户ID' },
        conversationId: { type: 'string', description: '关联的对话ID' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        metadata: { type: 'object', description: '额外元数据' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: '文档删除',
    description: '删除文档（仅支持数据库文档）',
    inputSchema: {
      type: 'object',
      properties: { documentId: { type: 'string', description: '文档ID' } },
      required: ['documentId'],
    },
  },
];
