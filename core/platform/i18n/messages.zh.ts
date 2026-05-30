/**
 * [WHO]: messages - Chinese translations for user-facing messages
 * [FROM]: No external dependencies
 * [TO]: Consumed by core/platform/i18n/index.ts
 * [HERE]: core/platform/i18n/messages.zh.ts - Chinese message translations
 */

export const messages = {
	// General
	error: "错误",
	warning: "警告",
	info: "提示",
	success: "成功",
	confirm: "确认",
	cancel: "取消",
	yes: "是",
	no: "否",
	ok: "确定",
	save: "保存",
	close: "关闭",
	retry: "重试",
	loading: "加载中...",

	// Session
	newSession: "新会话",
	continueSession: "继续会话",
	sessionSaved: "会话已保存",
	sessionLoaded: "会话已加载",
	noSessions: "未找到会话",

	// Settings
	settings: "设置",
	language: "语言",
	theme: "主题",
	model: "模型",
	thinkingLevel: "思考级别",

	// Model
	selectModel: "选择模型",
	modelChanged: "模型已切换为",
	noModelsAvailable: "没有可用模型",

	// API Key
	apiKeyRequired: "需要 API 密钥",
	enterApiKey: "请输入您的 API 密钥",
	apiKeySaved: "API 密钥已保存",
	apiKeyInvalid: "无效的 API 密钥",

	// Extensions
	extensions: "扩展",
	extensionEnabled: "扩展已启用",
	extensionDisabled: "扩展已禁用",
	extensionError: "扩展错误",

	// Memory
	memory: "记忆",
	memoryUpdated: "记忆已更新",
	memoryCleared: "记忆已清除",

	// Errors
	errorOccurred: "发生错误",
	tryAgain: "请重试",
	networkError: "网络错误",
	timeoutError: "请求超时",

	// Confirmations
	confirmQuit: "确定要退出吗？",
	confirmNewSession: "开始新会话？当前会话将被保存。",
	confirmDelete: "确定要删除吗？",

	// Presence (AI生成失败或记忆为空时的备用消息)
	presence: {
		opening: [
			"来了啊。",
			"嘿，有什么想做的吗？",
			"准备开始吧。",
			"随时可以开始。",
			"有什么要聊聊的吗？",
		],
		idle: [
			"还在，有需要随时说。",
			"不急，慢慢来。",
			"我在，随时继续。",
			"有空了就继续吧。",
			"没关系的，想什么时候继续都行。",
		],
	},
};
