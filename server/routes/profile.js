/**
 * 执行配置 Profile API 路由
 * 
 * GET    /api/profile           - 列出所有配置
 * GET    /api/profile/:id       - 查看配置详情（按标识）
 * POST   /api/profile           - 创建自定义配置
 * PUT    /api/profile/:id       - 更新配置
 * DELETE /api/profile/:id       - 删除配置
 * GET    /api/profile/tags/list - 获取所有标签
 */

import { Router } from 'express';
import { 列出配置, 获取配置详情, 创建配置, 更新配置, 删除配置, 获取所有标签 } from '../执行配置管理.js';

const router = Router();

/**
 * 列出所有执行配置
 * GET /api/profile
 * 查询参数: ?tag=爬虫&keyword=crawler
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const 筛选 = {
      标签: req.query.tag || null,
      关键词: req.query.keyword || null,
    };
    const 列表 = await 列出配置(userId, 筛选);
    res.json({ success: true, data: 列表 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 获取所有标签
 * GET /api/profile/tags/list
 */
router.get('/tags/list', async (req, res) => {
  try {
    const 标签列表 = await 获取所有标签();
    res.json({ success: true, data: 标签列表 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 查看配置详情
 * GET /api/profile/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const 配置 = await 获取配置详情(req.params.id);
    if (!配置) {
      return res.status(404).json({ success: false, error: `配置 "${req.params.id}" 不存在` });
    }
    res.json({ success: true, data: 配置 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 创建自定义配置
 * POST /api/profile
 * 请求体: { 标识, 名称, 描述, 标签, 执行约束, 能力约束, 工具约束, 技能约束, 意图约束 }
 */
router.post('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const 配置 = await 创建配置(req.body, userId);
    res.status(201).json({ success: true, data: 配置 });
  } catch (e) {
    const status = e.message.includes('已存在') ? 409 : 400;
    res.status(status).json({ success: false, error: e.message });
  }
});

/**
 * 更新配置
 * PUT /api/profile/:id
 * 请求体: { 要更新的字段... }
 */
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const 结果 = await 更新配置(req.params.id, req.body, userId);
    res.json({ success: true, data: 结果 });
  } catch (e) {
    const status = e.message.includes('不存在') ? 404 : 
                   e.message.includes('无权') ? 403 : 
                   e.message.includes('仅允许') ? 403 : 400;
    res.status(status).json({ success: false, error: e.message });
  }
});

/**
 * 删除配置
 * DELETE /api/profile/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const 结果 = await 删除配置(req.params.id, userId);
    res.json({ success: true, data: 结果 });
  } catch (e) {
    const status = e.message.includes('不存在') ? 404 : 
                   e.message.includes('不可删除') ? 403 : 
                   e.message.includes('无权') ? 403 : 400;
    res.status(status).json({ success: false, error: e.message });
  }
});

export default router;
