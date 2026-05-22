/**
 * 白鸽服务端API路由 - 聚合器
 * 子路由：task.js（任务CRUD+操作）、task-stream.js（SSE流+轨迹）
 *         chat.js（对话+消息）、diagnostic.js（系统诊断）
 */

import { Router } from 'express';
import taskRouter from './api/task.js';
import taskStreamRouter from './api/task-stream.js';
import chatRouter from './api/chat.js';
import diagnosticRouter from './api/diagnostic.js';

const router = Router();

// 挂载各子路由（路径已内聚在各子文件中，互不重叠）
router.use('/', taskRouter);
router.use('/', taskStreamRouter);
router.use('/', chatRouter);
router.use('/', diagnosticRouter);

export default router;

