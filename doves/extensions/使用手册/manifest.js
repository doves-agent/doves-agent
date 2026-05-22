export default {
  name: '使用手册',
  version: '1.0.0',
  description: '白鸽系统官方使用手册 — 快速索引、命令参考、扩展开发指南、架构说明',
  abilities: ['文档', '帮助', '手册'],
  dependencies: [],
  developer: { id: 'dev_official', signature: 'hmac-sha256:934397f5d81ba502ecfb4d35e66c424084e34551995de53e98498e15c53806c1' },
  permissions: {},
  web: {
    root: 'web',
    nav: { icon: '📖', label: '使用手册' },
    pages: {
      'index': { title: '使用手册', entry: './web/index.html' },
    }
  }
};
