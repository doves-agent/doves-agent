/**
 * 白鸽 MCP 配置管理
 * 职责：MCP Server 的增删改查、测试、刷新、工具查看
 */

import { display } from '../../display.js';
import { loadConfig } from '../../lib/config.js';
import { select, input, MCP_TYPE_CHOICES } from '../../lib/interactive.js';
import chalk from 'chalk';

const MCP_SUB_CHOICES = [
  { name: 'list     - 列出MCP Server', value: 'list' },
  { name: 'add      - 添加MCP Server', value: 'add' },
  { name: 'remove   - 删除MCP Server', value: 'remove' },
  { name: 'enable   - 启用MCP Server', value: 'enable' },
  { name: 'disable  - 禁用MCP Server', value: 'disable' },
  { name: 'test     - 测试MCP连接', value: 'test' },
  { name: 'refresh  - 刷新MCP能力发现', value: 'refresh' },
  { name: 'tools    - 查看MCP工具详情', value: 'tools' },
];

/**
 * MCP配置管理
 */
async function handleMCP(client, args, options) {
  let subCommand = args[0];
  
  if (!subCommand) {
    subCommand = await select('选择MCP操作', MCP_SUB_CHOICES);
  }
  
  // 获取当前鸽子ID
  const config = loadConfig();
  const doveId = args[1] || config.currentDoveId;
  
  switch (subCommand) {
    case 'list':
    case 'ls':
      await handleMCPList(client, doveId);
      break;
    case 'add':
      await handleMCPAdd(client, args[1], options);
      break;
    case 'remove':
    case 'rm':
      await handleMCPRemove(client, args[1] || args[2], doveId);
      break;
    case 'enable':
      await handleMCPEnable(client, args[1] || args[2], doveId);
      break;
    case 'disable':
      await handleMCPDisable(client, args[1] || args[2], doveId);
      break;
    case 'test':
      await handleMCPTest(client, args[1] || args[2], doveId);
      break;
    case 'refresh':
      await handleMCPRefresh(client, doveId);
      break;
    case 'tools':
      await handleMCPTools(client, args[1] || args[2], doveId);
      break;
    default:
      display.error(`未知MCP操作: ${subCommand}`);
      showMCPHelp();
  }
}

/**
 * 列出MCP Server
 */
async function handleMCPList(client, doveId) {
  if (!doveId) {
    display.error('请指定鸽子ID，或先使用 dove dove use 设置当前鸽子');
    return;
  }
  
  const spinner = display.spinner('获取MCP配置...').start();
  try {
    const mcpConfig = await client.getMCPConfig(doveId);
    spinner.stop();
    
    if (!mcpConfig?.servers?.length) {
      display.info('暂无MCP Server配置');
      return;
    }
    
    display.title('MCP Server列表');
    console.log();
    
    for (const server of mcpConfig.servers) {
      const statusIcon = server.启用 ? chalk.green('●') : chalk.gray('○');
      const connStatus = server.连接状态 === 'connected' ? chalk.green('已连接') :
                         server.连接状态 === 'error' ? chalk.red('错误') :
                         chalk.gray('未连接');
      
      console.log(`  ${statusIcon} ${chalk.cyan(server.名称)} (${server.类型})`);
      console.log(`      状态: ${connStatus} | 工具: ${server.工具列表?.length || 0}`);
      if (server.类型 === 'stdio' && server.command) {
        console.log(`      命令: ${server.command} ${(server.args || []).join(' ')}`);
      } else if (server.url) {
        console.log(`      URL: ${server.url}`);
      }
      console.log();
    }
  } catch (err) {
    spinner.stop();
    display.error(`获取MCP配置失败: ${err.message}`);
  }
}

/**
 * 添加MCP Server
 */
async function handleMCPAdd(client, name, options) {
  const config = loadConfig();
  const doveId = config.currentDoveId;
  
  if (!doveId) {
    display.error('请先使用 dove dove use 设置当前鸽子');
    return;
  }
  
  if (!name) {
    name = await input('输入MCP Server名称');
    if (!name) { display.error('名称不能为空'); return; }
  }
  
  // 交互式选择MCP类型
  let type = options.type;
  if (!type) {
    type = await select('选择MCP类型', MCP_TYPE_CHOICES, 'stdio');
  }
  
  if (!['stdio', 'http', 'sse'].includes(type)) {
    display.error('类型必须是 stdio、http 或 sse');
    return;
  }
  
  // 构建配置
  const mcpConfig = {
    名称: name,
    类型: type
  };
  
  if (type === 'stdio') {
    if (!options.command) {
      mcpConfig.command = await input('输入stdio命令');
    } else {
      mcpConfig.command = options.command;
    }
    if (!mcpConfig.command) { display.error('stdio类型需要命令'); return; }
    mcpConfig.args = options.args ? options.args.split(',').map(s => s.trim()) : [];
    if (options.cwd) mcpConfig.cwd = options.cwd;
  } else {
    if (!options.url) {
      mcpConfig.url = await input('输入HTTP/SSE URL');
    } else {
      mcpConfig.url = options.url;
    }
    if (!mcpConfig.url) { display.error('http/sse类型需要URL'); return; }
  }
  
  // 解析环境变量
  if (options.env) {
    mcpConfig.env = {};
    for (const pair of options.env.split(',')) {
      const [key, value] = pair.split('=');
      if (key && value) {
        mcpConfig.env[key.trim()] = value.trim();
      }
    }
  }
  
  const spinner = display.spinner('添加MCP Server...').start();
  try {
    const result = await client.addMCPServer(doveId, mcpConfig);
    spinner.stop();
    
    if (result.success) {
      display.success(`MCP Server "${name}" 添加成功`);
      console.log();
      console.log(`  类型: ${type}`);
      console.log(`  建议: 运行 ${chalk.cyan(`dove dove mcp test ${name}`)} 测试连接`);
      console.log();
    } else {
      display.error(`添加失败: ${result.error}`);
    }
  } catch (err) {
    spinner.stop();
    display.error(`添加失败: ${err.message}`);
  }
}

/**
 * 删除MCP Server
 */
async function handleMCPRemove(client, name, doveId) {
  if (!doveId) {
    display.error('请指定鸽子ID，或先使用 dove dove use 设置当前鸽子');
    return;
  }
  
  if (!name) {
    display.error('请指定MCP Server名称');
    return;
  }
  
  const spinner = display.spinner('删除MCP Server...').start();
  try {
    const result = await client.removeMCPServer(doveId, name);
    spinner.stop();
    
    if (result.success) {
      display.success(`MCP Server "${name}" 已删除`);
    } else {
      display.error(`删除失败: ${result.error}`);
    }
  } catch (err) {
    spinner.stop();
    display.error(`删除失败: ${err.message}`);
  }
}

/**
 * 启用MCP Server
 */
async function handleMCPEnable(client, name, doveId) {
  if (!doveId) {
    display.error('请指定鸽子ID，或先使用 dove dove use 设置当前鸽子');
    return;
  }
  
  if (!name) {
    display.error('请指定MCP Server名称');
    return;
  }
  
  const spinner = display.spinner('启用MCP Server...').start();
  try {
    const result = await client.enableMCPServer(doveId, name);
    spinner.stop();
    
    if (result.success) {
      display.success(`MCP Server "${name}" 已启用`);
    } else {
      display.error(`启用失败: ${result.error}`);
    }
  } catch (err) {
    spinner.stop();
    display.error(`启用失败: ${err.message}`);
  }
}

/**
 * 禁用MCP Server
 */
async function handleMCPDisable(client, name, doveId) {
  if (!doveId) {
    display.error('请指定鸽子ID，或先使用 dove dove use 设置当前鸽子');
    return;
  }
  
  if (!name) {
    display.error('请指定MCP Server名称');
    return;
  }
  
  const spinner = display.spinner('禁用MCP Server...').start();
  try {
    const result = await client.disableMCPServer(doveId, name);
    spinner.stop();
    
    if (result.success) {
      display.success(`MCP Server "${name}" 已禁用`);
    } else {
      display.error(`禁用失败: ${result.error}`);
    }
  } catch (err) {
    spinner.stop();
    display.error(`禁用失败: ${err.message}`);
  }
}

/**
 * 测试MCP Server连接
 */
async function handleMCPTest(client, name, doveId) {
  if (!doveId) {
    display.error('请指定鸽子ID，或先使用 dove dove use 设置当前鸽子');
    return;
  }
  
  if (!name) {
    display.error('请指定MCP Server名称');
    return;
  }
  
  const spinner = display.spinner(`测试连接 ${name}...`).start();
  try {
    const result = await client.testMCPServer(doveId, name);
    spinner.stop();
    
    if (result.success) {
      display.success(`MCP Server "${name}" 连接成功`);
      console.log();
      console.log(`  工具数量: ${result.data.工具数量}`);
      
      if (result.data.工具列表?.length > 0) {
        console.log(`  工具列表:`);
        for (const tool of result.data.工具列表.slice(0, 10)) {
          console.log(`    - ${tool.name}: ${tool.description?.substring(0, 50) || '无描述'}`);
        }
        if (result.data.工具列表.length > 10) {
          console.log(`    ... 还有 ${result.data.工具列表.length - 10} 个工具`);
        }
      }
      console.log();
    } else {
      display.error(`连接失败: ${result.data?.错误 || result.error}`);
    }
  } catch (err) {
    spinner.stop();
    display.error(`测试失败: ${err.message}`);
  }
}

/**
 * 刷新MCP能力发现
 */
async function handleMCPRefresh(client, doveId) {
  if (!doveId) {
    display.error('请指定鸽子ID，或先使用 dove dove use 设置当前鸽子');
    return;
  }
  
  const spinner = display.spinner('刷新MCP能力...').start();
  try {
    const result = await client.refreshMCPCapabilities(doveId);
    spinner.stop();
    
    if (result.success) {
      display.success('MCP能力刷新完成');
      console.log();
      console.log(`  刷新数量: ${result.data.刷新数量}`);
      console.log(`  成功数量: ${result.data.成功数量}`);
      
      if (result.data.工具汇总?.length > 0) {
        console.log();
        console.log(`  发现的工具:`);
        for (const item of result.data.工具汇总) {
          console.log(`    ${item.名称}: ${item.工具列表.length} 个工具`);
        }
      }
      console.log();
    } else {
      display.error(`刷新失败: ${result.error}`);
    }
  } catch (err) {
    spinner.stop();
    display.error(`刷新失败: ${err.message}`);
  }
}

/**
 * 查看MCP Server工具详情
 */
async function handleMCPTools(client, name, doveId) {
  if (!doveId) {
    display.error('请指定鸽子ID，或先使用 dove dove use 设置当前鸽子');
    return;
  }
  
  if (!name) {
    display.error('请指定MCP Server名称');
    return;
  }
  
  const spinner = display.spinner('获取工具详情...').start();
  try {
    const result = await client.getMCPServerTools(doveId, name);
    spinner.stop();
    
    display.title(`MCP Server "${name}" 工具详情`);
    console.log();
    console.log(`  类型: ${result.类型}`);
    console.log(`  连接状态: ${result.连接状态}`);
    console.log(`  最后连接: ${result.最后连接时间 || '未连接'}`);
    console.log();
    
    if (result.工具列表?.length > 0) {
      console.log(`  工具列表 (${result.工具列表.length} 个):`);
      console.log();
      for (const tool of result.工具列表) {
        console.log(`  ${chalk.cyan(tool.name)}`);
        console.log(`    ${tool.description || '无描述'}`);
        if (tool.inputSchema?.properties) {
          const params = Object.keys(tool.inputSchema.properties).join(', ');
          console.log(`    参数: ${params}`);
        }
        console.log();
      }
    } else {
      display.info('暂无工具，请先测试连接');
    }
  } catch (err) {
    spinner.stop();
    display.error(`获取工具失败: ${err.message}`);
  }
}

/**
 * 显示MCP帮助
 */
function showMCPHelp() {
  console.log('');
  display.title('MCP配置管理命令');
  console.log('  list, ls       列出MCP Server [doveId]');
  console.log('  add            添加MCP Server <名称> --type <类型> [选项]');
  console.log('  remove, rm     删除MCP Server <名称> [doveId]');
  console.log('  enable         启用MCP Server <名称> [doveId]');
  console.log('  disable        禁用MCP Server <名称> [doveId]');
  console.log('  test           测试MCP连接 <名称> [doveId]');
  console.log('  refresh        刷新MCP能力发现 [doveId]');
  console.log('  tools          查看MCP工具详情 <名称> [doveId]');
  console.log('');
  display.title('MCP选项');
  console.log('  --type <type>      类型 (stdio/http/sse)');
  console.log('  --command <cmd>    stdio命令');
  console.log('  --args <args>      命令参数 (逗号分隔)');
  console.log('  --url <url>        HTTP/SSE URL');
  console.log('  --cwd <dir>        工作目录');
  console.log('  --env <env>        环境变量 (KEY=VALUE,KEY2=VALUE2)');
  console.log('');
  display.title('示例');
  console.log('  dove dove mcp add qt_os_io --type stdio --command "./os_io_mcp.exe"');
  console.log('  dove dove mcp add my_mcp --type http --url "http://localhost:8080/mcp"');
  console.log('  dove dove mcp test qt_os_io');
  console.log('  dove dove mcp tools qt_os_io');
  console.log('');
}

export {
  MCP_SUB_CHOICES,
  handleMCP,
  showMCPHelp,
};
