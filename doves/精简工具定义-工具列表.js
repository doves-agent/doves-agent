/**
 * @file 精简工具定义-工具列表
 * @description 所有精简工具的 OpenAI function-calling 格式定义（传给 LLM 的 tools 参数）
 */

export const 精简工具列表 = [
  // ==================== 文件操作 ====================
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文件内容，输出带行号格式（行号+TAB+内容）。用于查看代码、配置、日志等。修改文件前必须先用此工具查看当前内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
          start_line: { type: 'integer', description: '起始行号（可选，1-based）' },
          end_line: { type: 'integer', description: '结束行号（可选，1-based，含）' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '写入内容到文件。会覆盖已有文件，不存在则创建。仅用于创建新文件或整体重写。修改已有文件请优先用 edit_file。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
          content: { type: 'string', description: '要写入的内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '精确编辑文件：查找 old_string 并替换为 new_string。只需提供要修改的片段及足够上下文，不需要输出整个文件。old_string 必须在文件中唯一匹配（含缩进和空白）。修改已有文件时优先使用此工具而非 write_file。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
          old_string: { type: 'string', description: '要被替换的原文（必须在文件中唯一匹配，包含足够上下文）' },
          new_string: { type: 'string', description: '替换后的新文本' },
          replace_all: { type: 'boolean', description: '是否替换所有匹配（默认 false，要求唯一匹配）' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出目录内容。返回每个条目的类型（目录/文件）和名称。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '目录绝对路径' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除文件或空目录。谨慎使用。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '文件或目录的绝对路径' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '按 glob 模式搜索文件。如 "**/*.js" 搜索所有 JS 文件。用于定位文件位置。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'glob 模式，如 **/*.js、**/test*.ts' },
          directory: { type: 'string', description: '搜索根目录（可选，默认为当前工作目录）' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_definitions',
      description: '提取文件中所有顶层定义（函数、类、变量、导出），不返回函数体。快速了解文件结构而无需读取全文。比 read_file 节省大量 token。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'directory_tree',
      description: '递归显示目录树结构（类似 tree 命令）。快速掌握项目布局，比反复 list_dir 高效得多。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录绝对路径' },
          depth: { type: 'integer', description: '最大递归深度（默认 3）' },
          show_files: { type: 'boolean', description: '是否显示文件（默认 true，false 则只显示目录）' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_read',
      description: '一次读取多个文件，返回合并结果。减少 tool call 轮次。每个文件独立返回带行号内容。最多 10 个文件。',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: '文件绝对路径列表（最多 10 个）' },
          max_lines_per_file: { type: 'integer', description: '每个文件最多读取行数（默认 200）' },
        },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'think',
      description: '内部推理工具——用于复杂问题的思考和规划。输出不会返回给用户，仅帮助你理清思路。当面对复杂任务需要分析、权衡方案、检查遗漏时使用。不消耗工具轮次上限。',
      parameters: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: '你的推理过程、分析、计划等' },
        },
        required: ['thought'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_test',
      description: '执行项目测试命令并解析结果。自动检测测试框架（jest/mocha/vitest/pytest），返回结构化结果（通过数/失败数/失败详情）。比 shell_exec 更易理解测试结果。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '测试命令（可选，不传则自动检测 package.json scripts.test）' },
          cwd: { type: 'string', description: '工作目录（可选）' },
          timeout: { type: 'integer', description: '超时秒数（默认 120）' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_and_replace',
      description: '在多个文件中查找并替换文本。支持正则表达式和 glob 文件过滤。返回所有替换的预览（文件:行号:替换前→替换后）。适用于跨文件重命名变量、修改 import 路径等。',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: '要查找的文本或正则表达式' },
          replace: { type: 'string', description: '替换为的文本' },
          directory: { type: 'string', description: '搜索目录（默认当前工作目录）' },
          glob: { type: 'string', description: '文件名过滤，如 "*.js"、"*.{ts,tsx}"' },
          is_regex: { type: 'boolean', description: '是否将 search 当作正则表达式（默认 false）' },
          dry_run: { type: 'boolean', description: '是否仅预览不实际替换（默认 false）' },
        },
        required: ['search', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_progress',
      description: '压缩当前对话历史，用摘要替换旧的工具调用结果。当对话变长、接近 token 上限时主动使用，释放上下文空间继续工作。调用后旧的详细工具结果会被摘要替代。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '对之前工作的摘要：做了什么、结论是什么、还剩什么要做' },
          keep_last: { type: 'integer', description: '保留最近 N 轮工具调用的详细结果（默认 3）' },
        },
        required: ['summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep_code',
      description: '用正则表达式搜索文件内容（类似 ripgrep）。用于查找函数定义、引用、错误信息等。支持上下文行显示和仅返回文件名模式。',
      parameters: {
        type: 'object',
        properties: {
          regex: { type: 'string', description: '正则表达式，如 "function\\s+\\w+" 或 "import.*from"' },
          path: { type: 'string', description: '搜索路径（可选，文件或目录）' },
          glob: { type: 'string', description: '文件名过滤，如 "*.js"' },
          context: { type: 'integer', description: '显示匹配行前后各 N 行上下文（可选，默认 0）' },
          ignore_case: { type: 'boolean', description: '是否忽略大小写（可选，默认 false）' },
          files_only: { type: 'boolean', description: '是否只返回匹配的文件路径（不显示匹配行内容）' },
        },
        required: ['regex'],
      },
    },
  },

  // ==================== Shell 执行 ====================
  {
    type: 'function',
    function: {
      name: 'shell_exec',
      description: '执行 Shell 命令并返回输出。可以运行 git、npm、node 等命令。超时 60 秒。禁止用于安装 Python/系统依赖（pip/apt/brew 等），只用于已安装的命令。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令' },
          cwd: { type: 'string', description: '工作目录（可选）' },
          timeout: { type: 'integer', description: '超时秒数（可选，默认 60）' },
        },
        required: ['command'],
      },
    },
  },

  // ==================== Git 操作 ====================
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: '查看 Git 仓库状态（修改、暂存、未跟踪文件）。',
      parameters: { type: 'object', properties: { repo_path: { type: 'string', description: '仓库路径（可选，默认当前目录）' } }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: '查看 Git 差异。不传参数看未暂存的改动，staged=true 看已暂存的。',
      parameters: { type: 'object', properties: { repo_path: { type: 'string', description: '仓库路径（可选）' }, staged: { type: 'boolean', description: '是否只看已暂存的改动' }, file_path: { type: 'string', description: '只看指定文件的差异（可选）' } }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: '查看 Git 提交历史。',
      parameters: { type: 'object', properties: { repo_path: { type: 'string', description: '仓库路径（可选）' }, count: { type: 'integer', description: '返回条数（默认 20）' } }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_branch',
      description: '列出、创建或删除 Git 分支。',
      parameters: { type: 'object', properties: { repo_path: { type: 'string', description: '仓库路径（可选）' }, action: { type: 'string', enum: ['list', 'create', 'delete'], description: '操作类型' }, name: { type: 'string', description: '分支名（create/delete 时必填）' } }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_checkout',
      description: '切换分支或恢复文件。',
      parameters: { type: 'object', properties: { repo_path: { type: 'string', description: '仓库路径（可选）' }, target: { type: 'string', description: '分支名、标签或提交哈希' }, create_branch: { type: 'boolean', description: '是否创建新分支（相当于 git checkout -b）' } }, required: ['target'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: '提交更改。',
      parameters: { type: 'object', properties: { repo_path: { type: 'string', description: '仓库路径（可选）' }, message: { type: 'string', description: '提交信息' }, files: { type: 'array', items: { type: 'string' }, description: '要提交的文件列表（可选，默认全部）' } }, required: ['message'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_push',
      description: '推送到远程仓库。',
      parameters: { type: 'object', properties: { repo_path: { type: 'string', description: '仓库路径（可选）' }, remote: { type: 'string', description: '远程名称（默认 origin）' }, branch: { type: 'string', description: '分支名（默认当前分支）' } }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_pull',
      description: '从远程仓库拉取。',
      parameters: { type: 'object', properties: { repo_path: { type: 'string', description: '仓库路径（可选）' }, remote: { type: 'string', description: '远程名称（默认 origin）' }, branch: { type: 'string', description: '分支名（默认当前分支）' } }, required: [] },
    },
  },

  // ==================== HTTP 请求 ====================
  {
    type: 'function',
    function: {
      name: 'http_get',
      description: '发送 HTTP GET 请求。用于调用 API、获取资源等。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '请求 URL（含 https://）' }, headers: { type: 'object', description: '请求头（可选）' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_post',
      description: '发送 HTTP POST 请求。用于提交数据、调用 API 等。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '请求 URL（含 https://）' }, body: { type: 'string', description: '请求体（JSON 字符串或纯文本）' }, headers: { type: 'object', description: '请求头（可选，默认 Content-Type: application/json）' } }, required: ['url'] },
    },
  },

  // ==================== Web 搜索 ====================
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索网页，返回标题、URL 和摘要。用于查找最新信息、文档、解决方案等。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' }, count: { type: 'integer', description: '返回结果数（默认 5）' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: '抓取网页内容（提取纯文本）。用于阅读文档、文章等。返回去 HTML 后的纯文本。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '网页 URL' }, max_chars: { type: 'integer', description: '最大返回字符数（默认 5000）' } }, required: ['url'] },
    },
  },

  // ==================== 代码语义搜索 ====================
  {
    type: 'function',
    function: {
      name: 'search_codebase',
      description: '在代码库中搜索文件。用关键词描述要找的代码功能，如"登录逻辑"、"数据库连接"等。按关键词匹配文件内容，返回匹配的文件路径。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '用自然语言描述要找的代码功能' }, directory: { type: 'string', description: '搜索目录（可选，默认当前工作目录）' } }, required: ['query'] },
    },
  },

  // ==================== 图像生成/编辑 ====================
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '使用万相2.7或千问图像2.0模型生成或编辑图片。文生图只需 prompt；编辑已有图片同时提供 image_url（必须是公网 HTTP URL）。适用于生成插图、海报、Logo、抠图、换背景等。注意：①此工具是图生图模型，不能拆解/提取图中的独立元素——元素拆解请用 element_extract 工具；②返回编辑后的图片公网 URL，直接展示给用户即可，无需验证效果。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片描述或编辑指令（必填）' },
          image_url: { type: 'string', description: '参考图片URL（可选，编辑时提供）。必须是公网可访问的HTTP URL' },
          model: { type: 'string', enum: ['wan2.7-image-pro', 'qwen-image-2.0-pro'], description: '图像模型（默认 wan2.7-image-pro）' },
          size: { type: 'string', description: '输出分辨率。wan: 1K 或 2K（默认2K）；qwen: W*H 如 2048*2048' },
          n: { type: 'integer', description: '生成图片数量。wan:1-4，qwen:1-6（默认 1）' },
          negative_prompt: { type: 'string', description: '反向提示词（仅 qwen-image 支持），描述不想要的内容' },
        },
        required: ['prompt'],
      },
    },
  },

  // ==================== 元素拆解 ====================
  {
    type: 'function',
    function: {
      name: 'element_extract',
      description: '从图片中识别并拆解出每个独立元素（如人物、物品、图标、装饰等），每个元素单独一张图。内部自动完成两步：①视觉模型识图找元素 ②万相2.7组图模式逐个拆出。返回每个元素的图片URL。当用户要求"拆元素"、"抠图"、"提取元素"、"图像分割"时使用此工具，不要用 generate_image 替代。你可通过 prompt 参数控制万相模型的拆解指令（如"保持原始尺寸和比例"），通过 size 参数控制输出分辨率。',
      parameters: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: '原图公网URL（必填，由 request_upload 获取）' },
          elements: {
            type: 'array',
            items: { type: 'object', properties: { name: { type: 'string', description: '元素名称，如"左侧人物"、"红色汽车"' }, description: { type: 'string', description: '元素特征描述（颜色/形状/位置等）' } }, required: ['name'] },
            description: '已知元素列表（可选）。不传则自动用视觉模型识别图中所有元素',
          },
          prompt: { type: 'string', description: '发给万相2.7的拆解指令（可选）。用于控制拆解行为，如"保持每个元素在原图中的原始像素尺寸和比例，不要放大或缩小"、"白底，边缘干净"等。不传则使用默认提示词。关键：用户对尺寸/比例/背景等有明确要求时，务必在此参数中体现，否则万相模型不会知道。' },
          size: { type: 'string', description: '输出图片分辨率（可选）。wan2.7 支持：1K（1024级）、2K（2048级，默认）。用户要求保持原始尺寸时建议传 "1K" 减少缩放。' },
          background: { type: 'string', enum: ['white', 'transparent'], description: '元素背景色（默认 white 白底）' },
        },
        required: ['image_url'],
      },
    },
  },

  // ==================== TTS 语音合成 ====================
  {
    type: 'function',
    function: {
      name: 'speak_text',
      description: '将文本转为语音（TTS）。使用 CosyVoice 模型，支持中英等多语种。返回音频文件路径。',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '要合成的文本内容（必填，最大1000字）' }, voice: { type: 'string', description: '音色名称（默认 longanyang，可选 longxiaochun 等）' }, output_path: { type: 'string', description: '输出音频文件路径（可选，默认保存到临时目录）' } }, required: ['text'] },
    },
  },

  // ==================== 3D 模型生成 ====================
  {
    type: 'function',
    function: {
      name: 'generate_3d',
      description: '生成3D模型。支持文生3D（文本描述）、图生3D（单张图片）和多图生3D。使用 Tripo-H3.1 高精度模型，生成需1-5分钟。',
      parameters: { type: 'object', properties: { prompt: { type: 'string', description: '3D模型描述文本（文生3D时必填）' }, image_url: { type: 'string', description: '单张参考图片URL（图生3D时使用）' }, image_urls: { type: 'array', items: { type: 'string' }, description: '2-4张参考图片URL（多图生3D时使用）' }, quality: { type: 'string', enum: ['standard', 'detailed'], description: '贴图质量（默认 standard）' } }, required: [] },
    },
  },

  // ==================== 文件上传 ====================
  {
    type: 'function',
    function: {
      name: 'request_upload',
      description: '请求 CLI 将本地文件上传到 OSS。你运行在服务器端，无法直接访问用户本地的文件路径（如 C:\\Users\\...），需要用此工具让 CLI 代劳上传到 OSS，CLI 会回复公网 URL。上传完成后你才能用 generate_image 的 image_url 参数。每次最多请求 3 个文件。',
      parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: '需要上传的本地文件绝对路径列表（如 ["C:\\Users\\xxx\\photo.png"]）' } }, required: ['files'] },
    },
  },

  // ==================== CLI 协作 ====================
  {
    type: 'function',
    function: {
      name: 'cli_action',
      description: '请求 CLI 在用户本机执行操作。你运行在服务器端，以下场景必须通过此工具请求 CLI 协助：读取用户本地文件、在用户桌面保存文件、检查路径是否存在。CLI 支持的能力名（capability 参数必须用以下值之一）："cli_file_upload"（上传文件到OSS）、"cli_file_download"（下载文件到本地）、"cli_file_read"（读取本地文件）、"cli_local_path_check"（检查路径）。注意：CLI 不支持截图、shell_exec、system_info 等能力，不要请求这些。',
      parameters: { type: 'object', properties: { capability: { type: 'string', description: '能力名称，必须是以下之一："cli_file_upload"（上传文件到OSS）、"cli_file_download"（下载文件到本地）、"cli_file_read"（读取本地文件）、"cli_local_path_check"（检查路径是否存在）' }, params: { type: 'object', description: '操作参数，具体取决于 capability' }, description: { type: 'string', description: '操作描述（展示给用户看）' } }, required: ['capability', 'params', 'description'] },
    },
  },

  // ==================== 通知用户 ====================
  {
    type: 'function',
    function: {
      name: 'notify_user',
      description: '向用户发送通知消息（不等待回复）。用于告知用户当前进度、中间结果等。注意：此工具不会阻塞等待用户回复。',
      parameters: { type: 'object', properties: { message: { type: 'string', description: '通知内容' }, level: { type: 'string', enum: ['info', 'warn', 'error'], description: '通知级别（默认 info）' } }, required: ['message'] },
    },
  },

  // ==================== 能力发现 ====================
  {
    type: 'function',
    function: {
      name: 'discover_capability',
      description: '发现和查询可用扩展能力。当现有工具无法满足任务需求时（如 MongoDB 操作、视频处理等），用此工具查找是否有对应的扩展包能力可用。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '能力描述或关键词，如 "数据库操作"、"视频剪辑"' } }, required: ['query'] },
    },
  },

  // ==================== 任务拆分 ====================
  {
    type: 'function',
    function: {
      name: 'delegate_subtasks',
      description: '将当前复杂任务拆分为多个子任务并行执行。子任务会被其他鸽子实例抢走并行处理，当前鸽子等待全部完成后汇总返回。\n\n⚠️ 严格使用条件（全部满足才可用）：\n1. 任务包含多个相互独立或可串行的步骤\n2. 每个子任务的工作量足够大（预计各自需要3个以上工具调用）\n3. 总体工作量远超单次对话的处理能力（如处理几十个文件、多个独立查询等）\n\n❌ 严禁用于：简单问答、单文件修改、少于3步的任务、"帮我写个hello world"级别的任务\n\n💡 提示：depends_on 留空 = 可并行；指定子任务索引（0-based）= 等该索引的子任务完成后才执行',
      parameters: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            items: { type: 'object', properties: { description: { type: 'string', description: '子任务完整描述。必须自包含，包含所有必要信息，不引用"上面的结果"等' }, depends_on: { type: 'array', items: { type: 'integer' }, description: '依赖的子任务索引列表（0-based）。例如 [0, 1] 表示等第0和第1个子任务完成后才执行。留空或省略表示可立即并行执行' } }, required: ['description'] },
            description: '子任务列表。每个子任务必须自包含、无歧义。最多20个。',
          },
        },
        required: ['subtasks'],
      },
    },
  },

  // ==================== 长期记忆 ====================
  {
    type: 'function',
    function: {
      name: 'remember',
      description: '记住一段重要信息，供以后跨对话语义检索。信息会经过向量化存入记忆库。\n\n✅ 用于：用户偏好与习惯、项目约定与规范、重要决策与原因、学到的经验教训、用户明确要求记住的内容\n❌ 不用于：当前对话的临时上下文、一次性计算结果、已经有记录的内容',
      parameters: { type: 'object', properties: { content: { type: 'string', description: '要记住的内容。建议包含关键词便于后续检索。例如"用户偏好使用 React + TypeScript 技术栈，不喜欢 Vue"' }, category: { type: 'string', description: '记忆分类（可选）：技能记忆、对话记忆、经验记忆、用户画像、事件触发' }, title: { type: 'string', description: '记忆标题（可选）。用于快速识别，如"技术栈偏好"' } }, required: ['content'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description: '语义搜索之前记住的信息。通过向量相似度匹配检索最相关的记忆，支持跨模态检索（文本搜图片/音频记忆）。\n\n✅ 用于：回顾用户的偏好习惯、查找项目约定、回忆之前的决策、检索学到的经验、搜索多媒体记忆\n💡 在开始复杂任务前，先 recall 相关背景信息，避免重复询问用户已知的偏好',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索查询。用自然语言描述想找什么，如"用户喜欢什么技术栈"、"之前的登录系统是怎么设计的"' }, limit: { type: 'integer', description: '返回条数（默认5，最多20）' }, includeMultimodal: { type: 'boolean', description: '是否包含图片/音频/视频记忆（默认false）' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember_media',
      description: '记住多媒体内容（图片/音频/视频），支持跨模态语义检索。存入统一向量空间，之后可用文本描述搜索到。\n\n✅ 用于：记住用户分享的图片、保存语音备忘录、记录视频片段\n💡 提供文字描述可提高后续检索精度',
      parameters: { type: 'object', properties: { text: { type: 'string', description: '文字描述（可选但推荐）。描述多媒体内容便于后续检索' }, imageUrl: { type: 'string', description: '图片URL（OSS或公网可访问）' }, audioUrl: { type: 'string', description: '音频URL（OSS或公网可访问）' }, videoUrl: { type: 'string', description: '视频URL（OSS或公网可访问）' }, category: { type: 'string', description: '记忆分类（可选）：默认"经验记忆"' } }, required: [] },
    },
  },

  // ==================== 文件快照 ====================
  {
    type: 'function',
    function: {
      name: 'snapshot',
      description: '创建文件/目录快照或回滚到之前快照。用于保护性操作——批量修改前先存快照，出问题可回滚。\n\n✅ 用于：批量修改代码前保护现场、实验性操作前存档、重构前创建回滚点\n❌ 不用于：每次写文件都存快照（浪费存储）、替代 git（git 才是版本控制的正解）',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['create', 'rollback', 'list'], description: '操作类型：create=创建快照，rollback=回滚到指定快照，list=列出已有快照' }, path: { type: 'string', description: '文件或目录的绝对路径（create 时必填）' }, snapshot_id: { type: 'string', description: '快照ID（rollback 时必填）' } }, required: ['action'] },
    },
  },

  // ==================== 工具组加载 ====================
  {
    type: 'function',
    function: {
      name: 'load_tool_group',
      description: '按需加载工具组。当你需要某类工具但当前不可用时，调用此工具获取该组所有工具的完整定义。可用组名见系统提示词中的「可用工具组」。加载后的工具将在下一轮对话中可用。',
      parameters: { type: 'object', properties: { group: { type: 'string', description: '工具组名称，如 文件操作、Git版本控制、网络请求、媒体生成、扩展交互 等，具体见系统提示词' } }, required: ['group'] },
    },
  },
];
