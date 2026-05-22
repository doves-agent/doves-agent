/**
 * 人类分身角色定义
 */
export default {
  roles: {
    avatar_importer: {
      description: '聊天记录导入者 - 导入聊天记录到Git记忆',
      abilities: ['分身', '聊天记录'],
    },
    avatar_learner: {
      description: '语气学习者 - 分析聊天记录提取用户的语气特征',
      abilities: ['分身', '语气学习', '人格模拟'],
    },
    avatar_responder: {
      description: '分身回复者 - 按用户语气生成和发送回复',
      abilities: ['分身', '人格模拟', '自动回复'],
    },
    avatar_manager: {
      description: '分身管理者 - 配置分身行为、管理训练数据',
      abilities: ['分身', '自动回复'],
    },
  },
};
