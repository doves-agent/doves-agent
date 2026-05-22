/**
 * 电脑操作员角色定义
 */
export default {
  roles: {
    desktop_observer: {
      description: '桌面观察者 - 截图获取当前桌面状态，分析窗口布局和焦点',
      abilities: ['截图', '窗口管理'],
    },
    desktop_planner: {
      description: '桌面规划者 - 根据截图分析结果规划操作步骤',
      abilities: ['电脑操作', '窗口管理', '键鼠控制'],
    },
    desktop_operator: {
      description: '桌面执行者 - 执行键鼠操作、窗口管理、进程控制',
      abilities: ['电脑操作', '键鼠控制', '窗口管理', '进程控制'],
    },
    desktop_verifier: {
      description: '桌面验证者 - 截图对比验证操作结果',
      abilities: ['截图', '电脑操作'],
    },
  },
};
