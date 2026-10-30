export interface ArticleBlock {
  kind: 'paragraph' | 'heading' | 'quote' | 'code' | 'list' | 'table' | 'onebox' | 'details' | 'spoiler' | 'image' | 'emoji'
  level?: 2 | 3 | 4
  group?: number
  ordered?: boolean
  text: string
  summary?: string
  url?: string
  alt?: string
  width?: number
  height?: number
  inlineImages?: { offset: number; url: string; alt?: string; width?: number; height?: number }[]
}

export interface DiscussionPost {
  id: number
  number: number
  username: string
  name?: string
  avatarUrl?: string
  createdAt: number
  likeCount?: number
  replyToNumber?: number
  replyToUser?: string
  replyToPostId?: number
  blocks: ArticleBlock[]
}

export interface Discussion {
  topicId: string
  totalPosts: number
  loadedPosts: number
  participatingUsers?: number
  postIds?: number[]
  posts: DiscussionPost[]
}
export interface ArticleDocument {
  contentId: string
  sourceUrl: string
  title: string
  byline: string
  blocks: ArticleBlock[]
  text: string
  sourceHash: string
  revision: number
  fetchedAt: number
}

export interface ContentItem {
	images?: {url:string;width?:number;height?:number;alt?:string}[]
	articleBlocks?: ArticleBlock[]
	discussion?: Discussion
	paper?: PaperMetadata
	// A library card without its body; read the full item before saving it.
	partial?: boolean
  id: string
  platform: string
  platformId: string
  kind: 'video' | 'article' | 'audio' | 'pdf' | 'image'
  mediaUrl?: string
  title: string
  author: string
  authorId: string
  authorAvatarUrl?: string
  category?: string
  replyCount?: number
  likeCount?: number
  url: string
  thumbnailUrl: string
  thumbnailWidth?: number
  thumbnailHeight?: number
  description: string
  previewText?: string
  durationSeconds: number
  publishedAt: number
  viewCount?: number
  publishedText?: string
  savedAt?: number
}

export interface PaperMetadata {
  arxivId: string
  title?: string
  documentId?: string
  version?: number
  authors: string[]
  categories: string[]
  abstract: string
  publishedAt?: number
  updatedAt?: number
  pdfUrl: string
  arxivUrl: string
  hfUrl?: string
  githubUrl?: string
  upvotes?: number
  githubStars?: number
  aiKeywords?: string[]
}

export interface Feed {
  source?: string
  items: ContentItem[]
  page: number
  total: number
  hasMore: boolean
  sourceTitle: string
  query: string
}
export interface SearchPage {
  items: ContentItem[]
  cursor?: string
  hasMore: boolean
  platform: string
}
export interface SearchSourceResult { page: SearchPage; error?: string }
export interface UnifiedSearchResponse {
  query: string
  local: { items: ContentItem[]; total: number; counts: Record<string, number>; next?: number }
  sources: Record<string, SearchSourceResult>
  link?: Feed
}

export type DiscoveryView = 'wander' | 'latest' | 'topic' | 'random'
export interface DiscoveryBatchRequest {
  view: DiscoveryView
  /** Optional: the server chooses a feed page size when omitted. */
  size?: 10 | 15 | 25
  topic?: string
	source?: string
  /** Optional: server-side default keeps the subscription mix consistent. */
  subscriptionRatio?: number
  /** Optional: server-side default keeps exploration modest. */
  explorationRatio?: number
  cursor?: string
  seed?: number
  unreadIds?: string[]
}
export interface DiscoveryBatchItem {
  item: ContentItem
  source: string
  reason: string
  carriedOver: boolean
}
export interface DiscoveryBatchResponse {
  batchId: string
  nextCursor?: string
  items: DiscoveryBatchItem[]
  reason: string
  hasNextBatch: boolean
  endReason?: string
  sourceStatus: Record<string, DiscoverySourceStatus>
}
export interface DiscoverySourceStatus {
  status: string
  message?: string
  restricted?: boolean
  requiresVerification?: boolean
}
export interface DiscoveryFeedback {
  id: string
  type: 'more' | 'less' | 'hide' | 'block_creator'
  target: 'item' | 'source' | 'creator' | 'topic'
  value: string
  expiresAt?: number
  createdAt: number
}
export interface DiscoveryTopicRule {
  id: string
  name: string
  keywords: string[]
  groupId?: string
  revision: number
  createdAt: number
}

export interface DownloadOptions {
  mode?: 'video' | 'audio'
  container?: 'mp4' | 'mkv'
  videoOnly?: boolean
  audioFormat?: 'best' | 'mp3' | 'm4a' | 'flac' | 'wav' | 'opus'
  videoFormatId?: string
  audioFormatId?: string
  subtitleLanguages?: string[]
  automaticSubtitles?: boolean
  downloadDanmaku?: boolean
  downloadThumbnail?: boolean
  downloadInfoJSON?: boolean
  compress?: boolean
}

export interface DownloadFormat {
  id: string
  ext: string
  height: number
  width: number
  fps: number
  videoCodec: string
  audioCodec: string
  audioBitrate: number
  fileSize: number
  approximate: boolean
}

export interface DownloadMediaInfo {
  url: string
  title: string
  author: string
  thumbnailUrl: string
  duration: number
  extractor: string
  formats: DownloadFormat[]
  subtitles: { language: string; label: string; automatic: boolean }[]
}

export interface DownloadJob extends DownloadOptions {
  id: string
  url: string
  title: string
  thumbnailUrl?: string
  subdirectory?: string
  outputDirectory?: string
  maxHeight: number
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  message?: string
  progress?: number
  fileName?: string
  files?: string[]
  fileSize?: number
  originalSize?: number
  compressed?: boolean
  createdAt: number
  updatedAt: number
}

// Managed tools are downloaded into the app data directory on first use.
export interface ToolStatus {
  name: string
  available: boolean
  version?: string
  managed?: boolean
  installed?: boolean
  downloading?: boolean
  received?: number
  total?: number
  error?: string
}

export interface ToolReport {
  youtubeRecommendation?: { name: string; available: boolean; version?: string }
  tools: ToolStatus[]
  downloadReady: boolean
  downloadDir: string
  cookieConfigured: boolean
}

export type BackupTargetType = 'local' | 'webdav' | 's3'
export interface BackupTarget { id: string; name: string; type: BackupTargetType | string; path?: string; endpoint?: string; username?: string; remotePath?: string; allowInsecureTLS?: boolean; credentialConfigured?: boolean; password?: string; updateCredential?: boolean; enabled: boolean }
export interface BackupRemoteFolder { name: string; path: string }
export interface BackupTask { id: string; name: string; targetIds: string[]; includeDownloads: boolean; retention: number; intervalHours: number; targetIntervalHours?: Record<string, number>; enabled: boolean }
export interface BackupTargetRun { targetId: string; name: string; status: string; error?: string }
export interface BackupSnapshot { id: string; taskId?: string; createdAt: string; size: number; status: string; targets?: BackupTargetRun[]; retryAvailable?: boolean; retryUnavailableReason?: string }
export interface BackupRunErrorResponse { code: string; message: string; snapshot?: BackupSnapshot }
export interface BackupValidation { snapshotId: string; size: number; manifest: { formatVersion: number; schemaVersion: number; snapshotID: string; includeDownloads: boolean; files: Array<{ path: string; type: string; size: number; sha256: string }> } }
export interface BackupRestoreResult { planId: string; snapshotId: string; stagedId: string; preRestoreSnapshotId: string; status: string; restartRequired: boolean }

export interface SubtitleCue {
  start: number
  end: number
  text: string
}

export interface SubtitleTrack {
  language: string
  label: string
  automatic: boolean
  source?: 'cc' | 'ai' | 'yt-dlp' | 'youtube' | 'automatic'
  translated?: boolean
  sourceLanguage?: string
  mismatch?: boolean
  cues: SubtitleCue[]
}

export interface SubtitleLanguage {
  language: string
  label: string
  automatic: boolean
  source?: 'cc' | 'ai' | 'yt-dlp' | 'youtube' | 'automatic'
  hasUrl?: boolean
  translated?: boolean
  sourceLanguage?: string
}

export type SubtitleAvailability = 'cc' | 'ai' | 'ai_mismatch' | 'api_empty' | 'none' | 'login_required' | 'error' | 'rate_limited'

export interface SubtitlePart {
  cid: number
  page: number
  title?: string
  status: SubtitleAvailability
  aiMismatch?: boolean
  errorCode?: number
  errorMessage?: string
  languages: SubtitleLanguage[]
  tracks: SubtitleTrack[]
}

export interface SubtitleDocument {
  languages?: SubtitleLanguage[]
  parts?: SubtitlePart[]
  videoId: string
  part: number
  status: 'available' | 'none' | 'login_required' | 'api_empty' | 'error' | 'cc' | 'ai' | 'ai_mismatch' | 'rate_limited'
  errorCode?: number
  errorMessage?: string
  tracks: SubtitleTrack[]
}

export interface SavedSubtitle {
  contentId: string
  track: SubtitleTrack
  revision: number
  savedAt: number
  selected?: boolean
}

export interface TextAnchor {
  quote: string
  start: number
  end: number
  prefix: string
  suffix: string
  sourceHash: string
  postNumber?: number
  postId?: number
}

export interface ReadingNote {
	 source?: { title: string; author?: string; platform?: string; kind?: string }
	 pinned?: boolean
  tags?: string[]
  id: string
  contentId: string
  body: string
  positionSeconds: number | null
  textAnchor?: TextAnchor | null
  pdfAnchor?: PDFAnchor | null
  summaryAnchor?: SummaryAnchor | null
  subtitleReferences?: SubtitleReference[]
  /** Saved screenshots associated with this note. `frame` is kept for older servers. */
  frames?: NoteFrame[]
  frame?: NoteFrame | null
  createdAt: number
  updatedAt: number
}

export interface SummaryAnchor {
  nodeId: string
  unitId: string
  level: number
  sentenceIds?: string[]
  quote: string
  shown: string
}

export interface SubtitleReference { start: number; end: number; text: string; language: string; trackHash?: string }
export interface SubtitleSourceVersion { language: string; hash: string }
export interface NoteFrame { id: string; downloadId: string; positionSeconds: number; approximate: boolean; width: number; height: number; createdAt: number; source?: 'player' }

export interface PDFRect { x: number; y: number; width: number; height: number }
export interface PDFAnchor { documentId: string; page: number; quote: string; rects: PDFRect[] }

export interface ReadingProgress {
  contentId: string
  positionSeconds: number
  durationSeconds: number
  completed: boolean
  revision: number
  updatedAt: number
}

export interface SubscriptionRefreshState {
  enabled: boolean
  intervalSeconds: number
  lastAttemptAt: number
  lastFailureAt: number
  lastCheckedAt: number
  nextCheckAt: number
  failures: number
  message?: string
  status: 'healthy' | 'never_checked' | 'stale' | 'auth_required' | 'rate_limited' | 'not_found' | 'upstream_error' | 'paused'
  suggestedAction?: string
  contentRevision: number
}
export interface SubscriptionSource {
  id: string
  creatorId: string
  name: string
  groupId: string
  url: string
  createdAt: number
  lastUpdatedAt: number
  sourceTitle: string
  itemCount: number
  total: number
  hasMore: boolean
  refresh: SubscriptionRefreshState
  active: boolean
}
export interface SubscriptionGroup { id: string; name: string; createdAt: number; revision: number }
export interface SubscriptionDetail {
  source: SubscriptionSource
  items: ContentItem[]
  notModified?: boolean
}

export interface ReadState { contentId: string; read: boolean; updatedAt: number }

export interface SubscriptionInboxEntry {
  item: ContentItem
  firstSeenAt: number
  lastSeenAt: number
  sources: { id: string; name: string; removed: boolean }[]
}
export interface SubscriptionInboxPage { entries: SubscriptionInboxEntry[]; sources: SubscriptionInboxEntry['sources']; nextCursor: string }
export interface SavedViewFilters {
  query: string
  sourceId: string
  groupId: string
  platform: string
  kind: string
  topic: string
  tag: string
  read: string
  favorite: boolean
  sinceOffset: string
  since: number
  until: number
}
export interface SavedViewDefinition { version: number; filters: SavedViewFilters }
export interface SavedView {
  id: string
  name: string
  definitionVersion: number
  definition: SavedViewDefinition
  icon: string
  color: string
  sortOrder: number
  default: boolean
  builtin: boolean
  count: number
}
export interface SavedViewInboxPage { page: SubscriptionInboxPage; count: number }
