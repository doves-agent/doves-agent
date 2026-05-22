/**
 * @file im-adapters/index
 * @description IM通知适配器统一入口，导出所有适配器及广播函数
 */

// 基类和注册函数
export { IMAdapter, registerAdapter, getAdapter, getAllAdapters, initAdapters, broadcastApproval, broadcastProgress, broadcastAlert } from './base.js';

// 具体适配器（导入即注册）
import './feishu.js';
import './wecom.js';
