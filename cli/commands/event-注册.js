/**
 * @file event-注册.js
 * @description 事件注册逻辑（handleSchedule + handleSemantic），从 event.js 抽取
 */

import chalk from 'chalk';
import { display } from '../display.js';

/**
 * 注册定时事件
 */
export async function handleSchedule(client, name, options) {
  if (!name) {
    display.error('请提供事件名称: dove event schedule "每日提醒" --cron "0 9 * * *" --task \'{"用户消息":"早上好"}\'');
    return;
  }
  if (!options.cron) {
    display.error('请提供 --cron 定时表达式');
    return;
  }
  
  let task;
  try {
    task = options.task ? JSON.parse(options.task) : { 用户消息: name };
  } catch (e) {
    display.error('--task 参数 JSON 格式错误');
    return;
  }
  
  const data = await client.post('/api/event/schedule', { name, cron: options.cron, task });

  display.success(`定时事件已注册: ${name}`);
  console.log(chalk.dim(`  ID: ${data.事件ID}`));
  console.log(chalk.dim(`  Cron: ${options.cron}`));
  console.log(chalk.dim(`  下次触发: ${data.下次触发时间 || '-'}`));
}

/**
 * 注册语义事件
 */
export async function handleSemantic(client, name, options) {
  if (!name) {
    display.error('请提供事件名称: dove event semantic "编程助手" --condition "当用户提到写代码" --task \'{"用户消息":"启动编程助手"}\'');
    return;
  }
  if (!options.condition) {
    display.error('请提供 --condition 语义触发条件');
    return;
  }
  
  let task;
  try {
    task = options.task ? JSON.parse(options.task) : { 用户消息: name };
  } catch (e) {
    display.error('--task 参数 JSON 格式错误');
    return;
  }
  
  const body = {
    name,
    condition: options.condition,
    task,
    threshold: options.threshold,
    llmConfirm: options.llmConfirm !== false,
    cooldown: options.cooldown
  };
  
  const data = await client.post('/api/event/semantic', body);

  display.success(`语义事件已注册: ${name}`);
  console.log(chalk.dim(`  ID: ${data.事件ID}`));
  console.log(chalk.dim(`  触发条件: ${options.condition}`));
  console.log(chalk.dim(`  阈值: ${options.threshold}`));
  console.log(chalk.dim(`  LLM确认: ${options.llmConfirm !== false ? '是' : '否'}`));
  console.log(chalk.dim(`  冷却时间: ${options.cooldown}秒`));
  if (data.记忆ID) {
    console.log(chalk.dim(`  记忆ID: ${data.记忆ID}`));
  }
}
