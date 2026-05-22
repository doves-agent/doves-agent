/**
 * Swagger API 文档配置
 *
 * 基于 swagger-jsdoc + swagger-ui-express 自动生成 OpenAPI 3.0 文档
 * - GET /api-docs     → Swagger UI 交互页面
 * - GET /api-docs.json → OpenAPI JSON（供 Postman/代码生成器导入）
 *
 * 路由文件中用 JSDoc 注释标注接口：
 *   /＊＊
 *    * @openapi
 *    * /auth/login:
 *    *   post:
 *    *     summary: 用户登录
 *    *     tags: [认证]
 *    *     requestBody:
 *    *       required: true
 *    *       content:
 *    *         application/json:
 *    *           schema:
 *    *             type: object
 *    *             required: [username, password]
 *    *             properties:
 *    *               username:
 *    *                 type: string
 *    *               password:
 *    *                 type: string
 *    *     responses:
 *    *       200:
 *    *         description: 登录成功
 *    * ＊/
 */

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { CONFIG } from './core.js';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '白鸽系统 API 文档',
      version: '1.0.0',
      description: '白鸽系统 - 分布式国产大模型 Agent 平台 API 文档',
    },
    servers: [
      {
        url: `http://localhost:${CONFIG.port}`,
        description: '本地开发环境',
      },
    ],
    components: {
      securitySchemes: {
        BearerToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT Token（X-Token 请求头）',
        },
        APIKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API Key（sk_keyId_secret 格式）',
        },
      },
    },
    tags: [
      { name: '认证', description: '用户注册/登录/Token管理/密码重置' },
      { name: '鸽子', description: '鸽子生命周期管理' },
      { name: '任务', description: '任务分发与结果提交' },
      { name: '对话', description: '对话管理' },
      { name: '用量统计', description: 'Token用量与成本看板' },
      { name: '健康检查', description: '存活/就绪/详细诊断' },
    ],
  },
  // 扫描所有路由文件的 JSDoc @openapi 注释
  apis: [
    './server/routes/*.js',
    './server/routes/api/*.js',
  ],
};

const swaggerSpec = swaggerJsdoc(options);

/**
 * 挂载 Swagger UI 到 Express 应用
 * @param {Express} app - Express 应用实例
 */
export function setupSwagger(app) {
  // Swagger UI 交互页面
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: '白鸽系统 API 文档',
  }));

  // OpenAPI JSON（供 Postman/代码生成器导入）
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

export default { setupSwagger, swaggerSpec };
