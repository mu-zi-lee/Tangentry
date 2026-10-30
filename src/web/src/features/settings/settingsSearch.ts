import type { SettingsRoute } from './registry'

type Entry = { label: string; group: string; keywords?: string; route: SettingsRoute }
export const settingsSearch: readonly Entry[] = [
  ...['卡片宽度', '圆角', '显示摘要'].map((label, index) => ({ label, group: '外观 · 内容卡片', route: { section: 'appearance' as const, target: ['card-width', 'card-corners', 'card-excerpt'][index] } })),
  ...['正文字体', '字号', '行高'].map((label, index) => ({ label, group: '外观 · 阅读', route: { section: 'appearance' as const, target: ['reading-font', 'reading-size', 'reading-height'][index] } })),
  { label: 'YouTube 首页推荐', group: '发现与推荐 · 推荐来源', keywords: '刷新', route: { section: 'discovery', target: 'recommendation-source' } },
  { label: '已屏蔽的频道与话题', group: '发现与推荐 · 已屏蔽', keywords: '不感兴趣 反馈 重置', route: { section: 'discovery', target: 'blocked-content' } },
  ...[['youtube', 'YouTube'], ['bilibili', '哔哩哔哩'], ['xiaohongshu', '小红书'], ['xiaoyuzhou', '小宇宙'], ['linuxdo', 'Linux.do'], ['douyin', '抖音']].flatMap(([platform, label]) => [
    { label: `${label} 登录`, group: '平台账号 · 平台账号', keywords: 'Cookie cookie 账号', route: { section: 'accounts' as const, platform, target: `account-${platform}` } },
    { label: `${label} 参与推荐`, group: '发现与推荐 · 参与推荐的平台', route: { section: 'discovery' as const, platform, target: `discovery-${platform}` } },
  ]),
  ...[['接口类型', 'ai-protocol'], ['接口地址', 'ai-url'], ['API 密钥', 'ai-key'], ['连接状态', 'ai-connection']].map(([label, target]) => ({ label, group: 'AI 服务 · 服务商', route: { section: 'ai' as const, tab: 'provider' as const, target } })),
  ...[['翻译模型', 'translation-model'], ['摘要模型', 'summary-model'], ['对话模型', 'chat-model'], ['翻译目标语言', 'translation-language'], ['提示词模板', 'ai-prompts'], ['模型库', 'ai-model-library']].map(([label, target]) => ({ label, group: 'AI 服务 · 翻译与摘要', route: { section: 'ai' as const, tab: 'text' as const, target } })),
  ...[['转录引擎', 'asr-engine'], ['本机模型', 'asr-models'], ['模型目录', 'model-directory']].map(([label, target]) => ({ label, group: 'AI 服务 · 字幕转录', keywords: 'whisper 字幕', route: { section: 'ai' as const, tab: 'asr' as const, target } })),
  ...[['启用 Agent Gateway', 'agent-enabled'], ['授权范围', 'agent-scopes'], ['连接 MCP 客户端', 'agent-connection'], ['轮换令牌', 'agent-token']].map(([label, target]) => ({ label, group: 'Agent 与 MCP', route: { section: 'agent' as const, target } })),
  ...[['下载目录', 'download-directory'], ['自动备份', 'automatic-backup'], ['备份加密', 'backup-encryption'], ['备份目标', 'backup-targets'], ['快照', 'backup-snapshots']].map(([label, target]) => ({ label, group: '数据与备份', keywords: '存储 恢复 WebDAV', route: { section: 'data' as const, target } })),
  { label: '应用更新', group: '组件与更新 · 应用', keywords: '版本', route: { section: 'system', target: 'application-update' } },
  { label: '下载组件', group: '组件与更新 · 下载组件', keywords: 'yt-dlp ffmpeg', route: { section: 'system', target: 'download-tools' } },
]
