/**
 * 白鸽服务端鸽子专用路由 - 聚合器
 * 子路由：dove-lifecycle.js（注册/查询/身份/下线）
 *         dove-config.js（系统配置/密钥/模型/管理后台）
 *         dove-capabilities.js（能力/权限策略/渠道权限）
 *         dove-task.js（抢任务/提交结果/心跳）
 *         dove-mcp.js（MCP配置管理）
 *         dove-extension-db.js（扩展数据库权限注册）
 *         dove-developer.js（开发者凭证管理）
 *         dove-app-auth.js（扩展审核与用户授权）
 *         dove-app-store.js（扩展包仓库：发布/搜索/下载）
 *         dove-app-delegate.js（应用发现与任务委派 — 已禁用）
 */

import { Router } from 'express';

// 子路由
import lifecycleRouter from './dove/dove-lifecycle.js';
import configRouter from './dove/dove-config.js';
import capabilitiesRouter from './dove/dove-capabilities.js';
import doveTaskRoutes from './dove-task.js';
import doveMcpRoutes from './dove-mcp.js';
import doveExtensionDbRoutes from './dove/dove-extension-db.js';
import doveDeveloperRoutes from './dove/dove-developer.js';
import doveAppAuthRoutes from './dove/dove-app-auth.js';
import doveAppStoreRoutes from './dove/dove-app-store.js';
// 应用发现与任务委派已禁用 — 应用开发者自行处理工具生态链
// import doveAppDelegateRoutes from './dove/dove-app-delegate.js';

const router = Router();

// 挂载子路由
router.use(lifecycleRouter);
router.use(configRouter);
router.use(capabilitiesRouter);
router.use(doveTaskRoutes);
router.use(doveMcpRoutes);
router.use('/extension', doveExtensionDbRoutes);
router.use('/developer', doveDeveloperRoutes);
router.use('/app', doveAppAuthRoutes);
router.use('/app/store', doveAppStoreRoutes);
// 应用发现与任务委派已禁用
// router.use('/app', doveAppDelegateRoutes);

export default router;
