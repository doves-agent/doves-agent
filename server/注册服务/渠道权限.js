/**
 * 渠道权限管理模块
 * 职责：鸽子的渠道权限更新与重置
 * 
 * 从 server/白鸽注册服务.js 拆分，遵循KISS原则
 */

import { getAdminDb, createTimestampFields, getTimestamp } from '../db.js';
import { toLocalISOString } from '@dove/common/时间工具.js';
import { logger } from '../core.js';
import { DEFAULT_CONFIG } from '../registration/config.js';

/**
 * 更新渠道权限
 */
export async function 更新渠道权限(doveId, 操作者ID, 角色, 渠道, 配置) {
  const adminDb = getAdminDb();
  
  try {
    const 合法角色 = ['鸽主', '授权'];
    const 合法渠道 = ['local', 'remote', 'wechat', 'dingtalk', 'feishu', '_default'];
    const 合法级别 = ['安全', '谨慎', '危险'];
    
    if (!合法角色.includes(角色)) {
      return { 成功: false, 错误: `无效的角色: ${角色}，合法值: ${合法角色.join('/')}` };
    }
    if (!合法渠道.includes(渠道)) {
      return { 成功: false, 错误: `无效的渠道: ${渠道}，合法值: ${合法渠道.join('/')}` };
    }
    if (配置.工具安全级别上限 && !合法级别.includes(配置.工具安全级别上限)) {
      return { 成功: false, 错误: `无效的安全级别: ${配置.工具安全级别上限}，合法值: ${合法级别.join('/')}` };
    }
    
    const 鸽子 = await adminDb.collection('鸽子身份').findOne({ 鸽子ID: doveId });
    if (!鸽子) return { 成功: false, 错误: '鸽子不存在' };
    if (鸽子.饲养员ID !== 操作者ID) return { 成功: false, 错误: '无权操作此鸽子的渠道权限' };
    
    const 当前渠道权限 = 鸽子.渠道权限 || DEFAULT_CONFIG.渠道权限;
    const 当前角色权限 = 当前渠道权限[角色] || (角色 === '鸽主' ? DEFAULT_CONFIG.渠道权限.鸽主 : DEFAULT_CONFIG.渠道权限.授权);
    const 当前渠道配置 = 当前角色权限[渠道] || 当前角色权限._default || { 工具安全级别上限: '谨慎', 禁用工具: [], 自定义提示: null };
    
    const 新渠道配置 = {
      工具安全级别上限: 配置.工具安全级别上限 ?? 当前渠道配置.工具安全级别上限,
      禁用工具: 配置.禁用工具 ?? 当前渠道配置.禁用工具,
      自定义提示: 配置.自定义提示 !== undefined ? 配置.自定义提示 : 当前渠道配置.自定义提示
    };
    
    const updateKey = `渠道权限.${角色}.${渠道}`;
    await adminDb.collection('鸽子身份').updateOne(
      { 鸽子ID: doveId },
      { $set: { [updateKey]: 新渠道配置, 更新时间: toLocalISOString(), 更新时间戳: getTimestamp() } }
    );
    
    logger.info(`渠道权限已更新: 鸽子 ${doveId}, 角色=${角色}, 渠道=${渠道}, 级别=${新渠道配置.工具安全级别上限}`);
    return { 成功: true, 渠道权限: { [角色]: { [渠道]: 新渠道配置 } } };
  } catch (错误) {
    logger.error(`更新渠道权限失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}

/**
 * 重置渠道权限为默认值
 */
export async function 重置渠道权限(doveId, 操作者ID, 角色) {
  const adminDb = getAdminDb();
  
  try {
    const 鸽子 = await adminDb.collection('鸽子身份').findOne({ 鸽子ID: doveId });
    if (!鸽子) return { 成功: false, 错误: '鸽子不存在' };
    if (鸽子.饲养员ID !== 操作者ID) return { 成功: false, 错误: '无权操作此鸽子的渠道权限' };
    
    const ts = createTimestampFields();
    
    if (角色) {
      const 角色默认 = 角色 === '鸽主' ? DEFAULT_CONFIG.渠道权限.鸽主 : DEFAULT_CONFIG.渠道权限.授权;
      await adminDb.collection('鸽子身份').updateOne(
        { 鸽子ID: doveId },
        { $set: { [`渠道权限.${角色}`]: 角色默认, 更新时间: ts.localTime } }
      );
      logger.info(`渠道权限已重置: 鸽子 ${doveId}, 角色=${角色}`);
    } else {
      await adminDb.collection('鸽子身份').updateOne(
        { 鸽子ID: doveId },
        { $set: { 渠道权限: DEFAULT_CONFIG.渠道权限, 更新时间: ts.localTime } }
      );
      logger.info(`渠道权限已全部重置: 鸽子 ${doveId}`);
    }
    
    return { 成功: true };
  } catch (错误) {
    logger.error(`重置渠道权限失败: ${错误.message}`);
    return { 成功: false, 错误: 错误.message };
  }
}
