/**
 * 事件管理 API - 聚合器
 *
 * 子路由:
 *   event/事件管理.js  - 注册定时/语义/变更事件 + 意图驱动事件 + CRUD
 *   event/事件查询.js  - 事件列表/详情/限额/待处理查询
 *   event/事件触发.js  - 手动触发/条件检查/摘要触发 + 用户交互(ask/answer/stream)
 */
import { Router } from 'express';
import 事件管理Router from './event/事件管理.js';
import 事件查询Router from './event/事件查询.js';
import 事件触发Router from './event/事件触发.js';

const router = Router();
router.use(事件触发Router);
router.use(事件管理Router);
router.use(事件查询Router);
export default router;
