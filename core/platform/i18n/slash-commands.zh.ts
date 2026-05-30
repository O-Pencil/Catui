/**
 * [WHO]: slashCommands - Chinese translations for slash command descriptions
 * [FROM]: No external dependencies
 * [TO]: Consumed by core/platform/i18n/index.ts
 * [HERE]: core/platform/i18n/slash-commands.zh.ts - Chinese slash command translations
 */

export const slashCommands = {
	categories: {
		core: "核心",
		model: "模型",
		memory: "记忆",
		session: "会话",
		workflow: "工作流",
		agents: "Agent",
		tools: "工具",
		admin: "管理",
	},
	settings: "打开设置菜单",
	model: "选择模型（打开选择器界面）",
	thinking: "选择当前模型的推理深度",
	"agent-loop": "选择 agent 推进任务的方式",
	"scoped-models": "选择快速切换里出现的模型",
	apikey: "更新当前提供商的 API 密钥",
	mcp: "管理 MCP 服务器（列出、启用、禁用）",
	soul: "显示 AI 人格和统计（灵魂）",
	persona: "切换 AI 人格/个性包",
	memory: "显示项目记忆和知识（纳米记忆）",
	dream: "刷新长期项目记忆（纳米记忆）",
	export: "将会话导出为 HTML 文件",
	share: "将会话分享为保密的 GitHub gist",
	copy: "复制上一条 AI 消息到剪贴板",
	name: "设置会话显示名称",
	session: "显示会话信息和统计",
	status: "显示代理状态卡片（模型、目录、会话、用量）",
	usage: "显示 token 使用量和费用统计",
	changelog: "显示更新日志条目",
	hotkeys: "显示所有键盘快捷键",
	resources: "显示已加载的扩展、提示、技能和主题",
	fork: "从上一条消息创建新分支",
	tree: "导航会话树（切换分支）",
	login: "通过 OAuth 提供商登录",
	logout: "从 OAuth 提供商登出",
	new: "开始新会话",
	update: "检查 NanoPencil 更新",
	reinstall: "强制重新安装 NanoPencil（干净安装）",
	compact: "手动压缩会话上下文",
	resume: "恢复其他会话",
	reload: "重新加载扩展、技能、提示和主题",
	"link-world": "设置联网访问工具",
	quit: "退出 NanoPencil",
	language: "切换语言（English/中文）",
};
