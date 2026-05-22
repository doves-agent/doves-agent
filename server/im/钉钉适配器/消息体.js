/**
 * 钉钉适配器 - 消息体构造模块
 * 
 * 提供钉钉消息体构造功能，支持文本/Markdown/ActionCard 格式
 */

/**
 * 构造企业应用消息体
 * 用于机器人单聊和工作通知 API
 * @param {Object} 消息 - 消息对象
 * @param {Object} [选项] - 额外选项
 * @param {string} [选项.robotCode] - 机器人 Code
 * @returns {Object} 钉钉企业消息体 { msgKey, msgParam }
 */
export function 构造企业消息体(消息, 选项 = {}) {
  // 优先使用 Markdown
  if (消息.toMarkdown) {
    const md = 消息.toMarkdown();

    // 审批请求用 ActionCard
    if (消息.constructor?.name === '审批请求消息') {
      const 任务ID = 消息.任务ID || 'unknown';
      return {
        msgKey: 'sampleActionCard',
        msgParam: JSON.stringify({
          title: '白鸽系统 - 审批请求',
          text: md,
          btnOrientation: '1',
          btnJsonList: [
            { title: '✅ 确认通过', actionUrl: `dtmd://dingtalkclient/sendMessage?content=确认_${任务ID}` },
            { title: '❌ 拒绝', actionUrl: `dtmd://dingtalkclient/sendMessage?content=拒绝_${任务ID}` },
          ],
        }),
      };
    }

    return {
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({
        title: 提取标题(md) || '白鸽系统通知',
        text: md,
      }),
    };
  }

  // 纯文本
  const text = 消息.toText ? 消息.toText() : String(消息);
  return {
    msgKey: 'sampleText',
    msgParam: JSON.stringify({ content: text }),
  };
}

/**
 * 构造群机器人消息体
 * 根据消息类型选择合适的格式
 * @param {Object} 消息 - 消息对象
 * @returns {Object} 钉钉消息格式
 */
export function 构造Webhook消息体(消息) {
  // 优先使用 Markdown 格式
  if (消息.toMarkdown) {
    const md = 消息.toMarkdown();

    // 审批请求用 ActionCard（带按钮）
    if (消息.constructor?.name === '审批请求消息') {
      return 构造ActionCard消息(md, 消息);
    }

    // 其他消息用 Markdown
    return {
      msgtype: 'markdown',
      markdown: {
        title: 提取标题(md) || '白鸽系统通知',
        text: md,
      },
    };
  }

  // 降级为纯文本
  return {
    msgtype: 'text',
    text: {
      content: 消息.toText ? 消息.toText() : String(消息),
    },
  };
}

/**
 * 构造 ActionCard 消息（带按钮）
 * 适用于审批请求等需要用户交互的场景
 * @param {string} markdown - Markdown 内容
 * @param {Object} 消息 - 原始消息对象
 * @returns {Object} ActionCard 消息格式
 */
export function 构造ActionCard消息(markdown, 消息) {
  const 任务ID = 消息.任务ID || 'unknown';

  return {
    msgtype: 'action_card',
    action_card: {
      title: '白鸽系统 - 审批请求',
      markdown: markdown,
      btn_orientation: '1', // 1=横向排列
      btn_json_list: [
        {
          title: '✅ 确认通过',
          action_url: `dtmd://dingtalkclient/sendMessage?content=确认_${任务ID}`,
        },
        {
          title: '❌ 拒绝',
          action_url: `dtmd://dingtalkclient/sendMessage?content=拒绝_${任务ID}`,
        },
      ],
    },
  };
}

/**
 * 从 Markdown 提取标题
 * @param {string} markdown - Markdown 文本
 * @returns {string|null} 标题
 */
export function 提取标题(markdown) {
  const 匹配 = markdown.match(/^#+\s*(.+)$/m);
  return 匹配 ? 匹配[1].trim() : null;
}
