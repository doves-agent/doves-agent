/**
 * 饲养员扩展机制 - 聚合器
 * 子路由：breeder-webhook.js（Webhook CRUD + 触发引擎）
 *         breeder-rule.js（自动化规则）
 *         breeder-template.js（任务模板）
 *         breeder-integrations.js（外部集成）
 */

import { Router } from 'express';

import webhookRouter from './breeder/breeder-webhook.js';
import ruleRouter from './breeder/breeder-rule.js';
import templateRouter from './breeder/breeder-template.js';
import integrationsRouter from './breeder/breeder-integrations.js';

const router = Router();

router.use(webhookRouter);
router.use(ruleRouter);
router.use(templateRouter);
router.use(integrationsRouter);

// 重新导出触发引擎供外部使用
export { 触发Webhook事件 } from './breeder/breeder-webhook.js';

export default router;
