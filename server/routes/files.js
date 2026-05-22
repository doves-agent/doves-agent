/**
 * 白鸽服务端文件操作路由
 * 职责：文件读写代理
 */

import { Router } from 'express';
import { CONFIG, logger } from '../core.js';
import { readFile, writeFile, deleteFile, listFiles } from '../file-service.js';

const router = Router();

/**
 * 读取文件
 */
router.get('{/*path}', async (req, res) => {
  const userId = req.user.userId;
  const rawPath = (req.params.path || []).join('/');
  
  try {
    const result = await readFile(userId, rawPath);
    res.send(result.content);
  } catch (e) {
    if (e.message === '文件不存在') {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }
    logger.error('读取文件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 写入文件
 */
router.put('{/*path}', async (req, res) => {
  const userId = req.user.userId;
  const rawPath = (req.params.path || []).join('/');
  const content = req.body?.content !== undefined ? req.body.content : req.body;
  
  try {
    const result = await writeFile(userId, rawPath, content);
    res.json({ success: true, ...result });
  } catch (e) {
    logger.error('写入文件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 删除文件
 */
router.delete('{/*path}', async (req, res) => {
  const userId = req.user.userId;
  const rawPath = (req.params.path || []).join('/');
  
  try {
    const result = await deleteFile(userId, rawPath);
    res.json({ success: true, ...result });
  } catch (e) {
    if (e.message === '文件不存在') {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }
    logger.error('删除文件失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * 列出目录
 */
router.get('/list{/*dir}', async (req, res) => {
  const userId = req.user.userId;
  const rawDir = (req.params.dir || []).join('/');
  
  try {
    const result = await listFiles(userId, rawDir);
    res.json({ success: true, ...result });
  } catch (e) {
    logger.error('列出目录失败:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
