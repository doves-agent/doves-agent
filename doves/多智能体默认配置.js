/**
 * @file 多智能体默认配置（Doves 入口）
 * @description 从 common 重导出，保持 doves 内部引用路径不变
 * 
 * 迁移说明：主定义已移至 common/多智能体默认配置.js，以支持 Server 引用（Server-Doves 隔离原则）。
 * 本文件仅做重导出，避免 doves 内部所有引用路径的连锁修改。
 */

export {
  默认主智能体角色名,
  默认智能体列表,
  获取默认配置,
  验证配置,
} from '../common/多智能体默认配置.js';

export { default } from '../common/多智能体默认配置.js';
