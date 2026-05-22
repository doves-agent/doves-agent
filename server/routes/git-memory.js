import express from 'express';
import * as 向量记忆 from '../向量服务/记忆服务.js';
import { 创建日志器 } from '@dove/common/日志管理器.js';

const logger = 创建日志器('记忆路由', { 前缀: '[记忆API]' });
const router = express.Router();

router.post('/search', async (req, res) => {
  const { query, userId, topK, category, threshold, includeMultimodal } = req.body;
  const 用户ID = userId || req.user.userId;

  if (!query) {
    return res.status(400).json({ success: false, error: '缺少参数: query' });
  }

  try {
    const 结果 = await 向量记忆.搜索记忆({
      用户ID,
      查询: query,
      类别: category,
      topK: topK || 10,
      阈值: threshold || undefined,
      包含多模态: !!includeMultimodal
    });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`搜索失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/add', async (req, res) => {
  const { userId, messages, metadata, content, category, title } = req.body;
  const 用户ID = userId || req.user.userId;

  // 兼容旧格式：messages 转为 content
  let 文本内容 = content;
  if (!文本内容 && messages) {
    文本内容 = messages.map(m => `${m.role || ''}:${m.content || ''}`).join('\n');
  }

  if (!文本内容) {
    return res.status(400).json({ success: false, error: '缺少参数: messages 或 content' });
  }

  try {
    const 结果 = await 向量记忆.添加记忆({
      用户ID,
      内容: 文本内容,
      类别: category || metadata?.type || '对话记忆',
      元数据: metadata || {},
      标题: title
    });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`添加失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/multimodal-add', async (req, res) => {
  const { userId, text, imageUrl, audioUrl, videoUrl, category, metadata } = req.body;
  const 用户ID = userId || req.user.userId;

  if (!text && !imageUrl && !audioUrl && !videoUrl) {
    return res.status(400).json({ success: false, error: '至少提供一种内容' });
  }

  try {
    const 结果 = await 向量记忆.添加多模态记忆({
      用户ID,
      文本: text,
      图片URL: imageUrl,
      音频URL: audioUrl,
      视频URL: videoUrl,
      类别: category || '经验记忆',
      元数据: metadata || {}
    });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`多模态添加失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/list', async (req, res) => {
  const { user_id, category, page, page_size } = req.query;
  const 用户ID = user_id || req.user.userId;

  try {
    const 结果 = await 向量记忆.获取记忆列表({
      用户ID,
      类别: category,
      页码: parseInt(page) || 1,
      每页数量: parseInt(page_size) || 20
    });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`列表失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/categories', async (req, res) => {
  const 结果 = await 向量记忆.获取类别列表();
  res.json({ success: true, data: 结果.data });
});

router.get('/stats', async (req, res) => {
  const 用户ID = req.query.user_id || req.user.userId;

  try {
    const 结果 = await 向量记忆.获取统计({ 用户ID });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`统计失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const 用户ID = req.user.userId;

  try {
    const 结果 = await 向量记忆.获取记忆({ 用户ID, 记忆ID: id });
    if (!结果.成功) return res.status(404).json({ success: false, error: 结果.错误 });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`获取失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { content, metadata } = req.body;
  const 用户ID = req.user.userId;

  try {
    const 结果 = await 向量记忆.更新记忆({ 用户ID, 记忆ID: id, 内容: content, 元数据: metadata });
    if (!结果.成功) return res.status(404).json({ success: false, error: 结果.错误 });
    res.json({ success: true, data: 结果.data });
  } catch (e) {
    logger.error(`更新失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const 用户ID = req.user.userId;

  try {
    const 结果 = await 向量记忆.删除记忆({ 用户ID, 记忆ID: id });
    if (!结果.成功) return res.status(404).json({ success: false, error: 结果.错误 });
    res.json({ success: true, deleted: id });
  } catch (e) {
    logger.error(`删除失败: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
