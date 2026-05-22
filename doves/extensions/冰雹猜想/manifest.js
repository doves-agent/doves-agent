export default {
  name: '冰雹猜想',
  version: '1.0.0',
  description: '冰雹猜想（Collatz 3n+1）可视化工具 — 轨迹曲线、位宽分析、珊瑚图、热力图',
  abilities: ['冰雹猜想', 'Collatz', '3n+1', '数学可视化'],
  dependencies: [],
  developer: {
    id: 'dev_official',
    signature: 'hmac-sha256:61e9979649d581d363ad809e9981b41802851ea709b9a218c95295257dd054bf',
  },
  permissions: {},
  web: {
    root: 'web',
    nav: { icon: '🧊', label: '冰雹猜想' },
    pages: {
      'index': { title: '冰雹猜想可视化', entry: './web/index.html' },
    },
  },
};
