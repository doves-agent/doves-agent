import express from 'express';
import * as 数据服务 from '../Git存储/数据服务.js';
import { logger } from '../Git存储/仓库管理.js';

const router = express.Router();

// ==================== 文件操作 ====================

router.get('/files', async (req, res) => {
  const { path: 路径 } = req.query;
  const 用户ID = req.user.userId;

  try {
    const 结果 = await 数据服务.列出文件({ 用户ID, 路径: 路径 || '' });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`[数据API] 列出文件失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/files/read', async (req, res) => {
  const { path: 路径, binary } = req.query;
  const 用户ID = req.user.userId;

  if (!路径) return res.status(400).json({ success: false, error: '缺少参数: path' });

  try {
    if (binary === 'true') {
      const 结果 = await 数据服务.读取二进制文件({ 用户ID, 路径 });
      if (!结果.成功) return res.status(404).json({ success: false, error: 结果.错误 });
      res.set('Content-Type', 'application/octet-stream');
      res.send(结果.data.buffer);
    } else {
      const 结果 = await 数据服务.读取文件({ 用户ID, 路径 });
      if (!结果.成功) return res.status(404).json({ success: false, error: 结果.错误 });
      res.json({ success: true, data: 结果.data });
    }
  } catch (e) {
    logger.error(`[数据API] 读取文件失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/files/write', async (req, res) => {
  const { path: 路径, content, message } = req.body;
  const 用户ID = req.user.userId;

  if (!路径) return res.status(400).json({ success: false, error: '缺少参数: path' });
  if (content === undefined) return res.status(400).json({ success: false, error: '缺少参数: content' });

  try {
    const 结果 = await 数据服务.写入文件({ 用户ID, 路径, 内容: content, 提交消息: message });
    if (!结果.成功) return res.status(400).json({ success: false, error: 结果.错误 });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`[数据API] 写入文件失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/files', async (req, res) => {
  const { path: 路径, message } = req.body;
  const 用户ID = req.user.userId;

  if (!路径) return res.status(400).json({ success: false, error: '缺少参数: path' });

  try {
    const 结果 = await 数据服务.删除文件({ 用户ID, 路径, 提交消息: message });
    if (!结果.成功) return res.status(404).json({ success: false, error: 结果.错误 });
    res.json({ success: true });
  } catch (e) {
    logger.error(`[数据API] 删除文件失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/files/history', async (req, res) => {
  const { path: 路径, limit } = req.query;
  const 用户ID = req.user.userId;

  if (!路径) return res.status(400).json({ success: false, error: '缺少参数: path' });

  try {
    const 结果 = await 数据服务.获取文件历史({ 用户ID, 路径, 数量: parseInt(limit) || 20 });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`[数据API] 获取历史失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 快照操作 ====================

router.get('/snapshots', async (req, res) => {
  const 用户ID = req.user.userId;

  try {
    const 结果 = await 数据服务.列出快照({ 用户ID });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`[数据API] 列出快照失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/snapshots', async (req, res) => {
  const { name, description } = req.body;
  const 用户ID = req.user.userId;

  if (!name) return res.status(400).json({ success: false, error: '缺少参数: name' });

  try {
    const 结果 = await 数据服务.创建快照({ 用户ID, 名称: name, 描述: description || '' });
    if (!结果.成功) return res.status(400).json({ success: false, error: 结果.错误 });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`[数据API] 创建快照失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/snapshots/restore', async (req, res) => {
  const { tag } = req.body;
  const 用户ID = req.user.userId;

  if (!tag) return res.status(400).json({ success: false, error: '缺少参数: tag' });

  try {
    const 结果 = await 数据服务.恢复快照({ 用户ID, 标签名: tag });
    if (!结果.成功) return res.status(400).json({ success: false, error: 结果.错误 });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`[数据API] 恢复快照失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/snapshots/:tag', async (req, res) => {
  const { tag } = req.params;
  const 用户ID = req.user.userId;

  try {
    const 结果 = await 数据服务.删除快照({ 用户ID, 标签名: tag });
    if (!结果.成功) return res.status(404).json({ success: false, error: 结果.错误 });
    res.json({ success: true });
  } catch (e) {
    logger.error(`[数据API] 删除快照失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
