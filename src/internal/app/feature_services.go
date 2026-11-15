package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	articleadapter "tangentry/internal/adapters/articles"
	"tangentry/internal/ai"
	"tangentry/internal/articles"
	"tangentry/internal/automaticsubtitles"
	"tangentry/internal/backup"
	"tangentry/internal/config"
	"tangentry/internal/content"
	"tangentry/internal/discovery"
	"tangentry/internal/downloads"
	"tangentry/internal/favoritesync"
	"tangentry/internal/history"
	"tangentry/internal/notes"
	"tangentry/internal/playback"
	"tangentry/internal/readingprogress"
	"tangentry/internal/readstate"
	"tangentry/internal/subscriptions"
	"tangentry/internal/subtitles"
	"tangentry/internal/transcription"
)

// apiBundle contains long-lived domain services, separate from external clients.
type apiBundle struct {
	content            *content.Service
	articles           *articles.Service
	recommendations    *recommender
	discoveryBatch     *discovery.BatchService
	discoveryFeedback  *discovery.FeedbackService
	sources            *subscriptions.Service
	downloads          *downloads.Service
	transcription      *transcription.Service
	automaticSubtitles *automaticsubtitles.Service
	modelDownloads     *transcription.ModelDownloads
	modelDir           string
	api                apiServices
}

type apiServices struct {
	ai                *ai.Service
	retrievalSettings *retrievalSettingsService
	compatibility     *playback.Compatibility
	favorites         *favoritesync.Service
	groupService      *subscriptions.GroupService
	inbox             *subscriptions.InboxService
	savedViews        *subscriptions.SavedViewService
	notes             *notes.Service
	noteFrames        *notes.Frames
	noteExports       *notes.ExportService
	playback          *playback.Service
	progress          *readingprogress.Service
	readState         *readstate.Service
	history           *history.Service
	preferences       *discovery.Preferences
	savedSubtitles    *subtitles.SavedService
	subtitles         *subtitles.Service
}

// wireFeatures builds domain services around the runtime capabilities. It does
// not start goroutines; lifecycle startup is kept in startBackgroundServices so
// construction remains deterministic and failures can be cleaned up uniformly.
func wireFeatures(dataDir string, configuration config.Config, option Options, runtime *runtimeResources, started *closers) (*apiBundle, error) {
	store, p, toolkit, processing := runtime.store, runtime.platforms, runtime.toolkit, runtime.downloads
	records := runtime.repositories
	feeds := subscriptionFeeds{platformSubscriptions: p.subscriptions, records: records.subscription}
	sources := subscriptions.NewService(store, feeds.snapshot, feeds.options()...)
	captions := subtitles.NewService(subtitleProvider{bilibili: p.media.bilibili, ytdlp: toolkit, youtube: toolkit})
	started.add(captions.Close)
	savedCaptions := subtitles.NewSavedService(store)
	contentService := content.NewService(store)
	inboxService := subscriptions.NewInboxService(store)
	savedViews := subscriptions.NewSavedViewService(store)
	recommendations := &recommender{
		platforms:     p,
		subscriptions: sources.Gallery,
		cache:         newRecommendationCache(),
		queue: discovery.NewRecommendationQueue(store, func(source string) discovery.QueueScope {
			return discovery.QueueScope{Platform: source, Account: discovery.PersonalAccount}
		}),
		override: option.Recommendations,
	}
	discoveryBatch := discovery.NewBatchService(recommendations, sources.Gallery, []string{"subscriptions", "bilibili", "youtube", "xiaohongshu", "linuxdo", "xiaoyuzhou", "douyin", "huggingface"}, store)
	discoveryBatch.SetSourceEnabled(func(ctx context.Context, source string) (bool, error) {
		return discovery.NewPreferences(store).Enabled(ctx, source)
	})
	discoveryBatch.SetTopicRules(discovery.NewTopicRules(store).List)
	discoveryFeedback := discovery.NewFeedbackService(store)
	discoveryBatch.SetFeedback(discoveryFeedback.List)

	resolvePlayback := p.media.bilibili.Playback
	if p.media.douyin != nil {
		resolvePlayback = func(ctx context.Context, id string) (playback.Source, error) {
			if strings.HasPrefix(id, "BV") {
				return p.media.bilibili.Playback(ctx, id)
			}
			return resolveDouyinPlayback(ctx, id,
				func(ctx context.Context, id string) (playback.Source, error) {
					media, err := p.media.douyin.ResolveVideoMedia(ctx, id)
					if err != nil {
						return playback.Source{}, err
					}
					return playback.Source{URL: media.URL, Backups: media.Backups, Platform: "douyin", Referer: "https://www.douyin.com/video/" + id}, nil
				}, p.network.toolkit.DouyinPlayback)
		}
	}
	if option.Playback != nil {
		resolvePlayback = option.Playback
	}
	resolveAudio := newAudioResolver(contentService, inboxService, processing, p.transcriptionSource(option.BilibiliAudio))
	speech, modelDownloads, modelDir, err := newTranscription(dataDir, configuration, p, option, resolveAudio, savedCaptions)
	if err != nil {
		return nil, err
	}
	started.add(speech.Close)
	started.add(modelDownloads.Close)
	automatic := automaticsubtitles.New(speech, savedCaptions, store)
	// Automatic subtitles are local-only. Do not advertise a streaming
	// recognizer while the configured transcription backend would require a
	// remote upload; the session then rejects the request before accepting PCM.
	if !speech.Status().Config.Cloud() {
		automatic.SetStreamingRecognizer(speech)
	}
	started.add(automatic.Close)

	var favoriteRemote favoritesync.Remote = p.media.bilibili
	if option.FavoritesRemote != nil {
		favoriteRemote = option.FavoritesRemote
	}
	favorites := favoritesync.New(store, favoriteRemote, processing)
	started.add(favorites.Close)
	noteService := notes.NewService(store)
	// B's retrieval: the engine is wired even when language AI storage is
	// unavailable so settings can still be saved; the saved-PDF hook
	// populates page text through the extraction service (local-first).
	retrievalEngine := newRetrievalEngine(store)
	retrievalSettings := newRetrievalSettingsService(store, retrievalEngine)
	pdfExtraction := newPDFExtraction(store)
	contentService.SetSavedHook(func(ctx context.Context, item content.Item) {
		extractSavedPDF(ctx, pdfExtraction, runtime.documents, item)
	})
	languageAI := newLanguageAI(dataDir, store, option)
	if languageAI != nil {
		languageAI.SetRetrievalEngine(retrievalEngine)
		languageAI.SetSummaryNoteWriter(func(ctx context.Context, result ai.SummaryResult) error {
			body := summaryNoteBody(result)
			createID := summaryNoteID(result.ContentID)
			saved, err := noteService.Create(ctx, notes.Input{CreateID: createID, ContentID: result.ContentID, Body: body, Tags: []string{"AI摘要"}})
			if err == nil || err == notes.ErrCreationConflict {
				if err == nil && saved.Body == body {
					_ = removeLegacySummaryNotes(ctx, noteService, result.ContentID, createID)
					return nil
				}
				items, listErr := noteService.List(ctx, result.ContentID)
				if listErr != nil {
					return listErr
				}
				for _, note := range items {
					if note.ID == createID || containsTag(note.Tags, "AI摘要") {
						if note.ID == createID {
							_, editErr := noteService.Edit(ctx, note.ID, notes.Edit{Body: body, Tags: &[]string{"AI摘要"}, ExpectedUpdatedAt: &note.UpdatedAt})
							if editErr != nil {
								return editErr
							}
							return removeLegacySummaryNotes(ctx, noteService, result.ContentID, createID)
						}
					}
				}
				// A pre-canonical auto note may have a random ID. Preserve its
				// content only when it is clearly generated, then let the stable
				// note created above be the sole automatic summary.
				if err := removeLegacySummaryNotes(ctx, noteService, result.ContentID, createID); err != nil {
					return err
				}
			}
			return err
		})
		started.add(languageAI.Close)
	}
	compatibility := newCompatibility(p)
	if compatibility != nil {
		started.add(func() { _ = compatibility.Close() })
	}
	started.add(sources.Close)

	return &apiBundle{
		content: contentService, articles: articles.New(store, &articleadapter.Extractor{HTTP: p.network.public}), sources: sources,
		recommendations: recommendations, discoveryBatch: discoveryBatch, discoveryFeedback: discoveryFeedback, downloads: processing, transcription: speech, automaticSubtitles: automatic, modelDownloads: modelDownloads, modelDir: modelDir,
		api: apiServices{
			ai: languageAI, retrievalSettings: retrievalSettings, compatibility: compatibility, favorites: favorites,
			groupService: subscriptions.NewGroupService(store), inbox: inboxService, savedViews: savedViews,
			notes: noteService, noteFrames: notes.NewFrames(store, processing.NoteFrameFile, toolkit.CaptureNoteFrame),
			noteExports: notes.NewExporter(store), playback: playback.New(resolvePlayback, p.network.public),
			progress: readingprogress.NewService(store), readState: readstate.New(store), history: history.New(store),
			preferences: discovery.NewPreferences(store), savedSubtitles: savedCaptions, subtitles: captions,
		},
	}, nil
}

func removeLegacySummaryNotes(ctx context.Context, service *notes.Service, contentID, keepID string) error {
	items, err := service.List(ctx, contentID)
	if err != nil {
		return err
	}
	for _, note := range items {
		if note.ID == keepID || !containsTag(note.Tags, "AI摘要") || !isGeneratedSummaryNote(note.Body) {
			continue
		}
		if err := service.Delete(ctx, note.ID, note.UpdatedAt); err != nil && !errors.Is(err, notes.ErrNotFound) {
			return err
		}
	}
	return nil
}

func isGeneratedSummaryNote(body string) bool {
	trimmed := strings.TrimSpace(body)
	return strings.HasPrefix(trimmed, "# AI 摘要") || strings.HasPrefix(trimmed, "# AI 主题地图")
}

func resolveDouyinPlayback(ctx context.Context, id string, pageResolve, ytdlpResolve func(context.Context, string) (playback.Source, error)) (playback.Source, error) {
	trace := playback.DiagnosticsFromContext(ctx)
	source, err := pageResolve(ctx, id)
	if err == nil && source.URL != "" {
		source.Platform, source.Referer = "douyin", "https://www.douyin.com/video/"+id
		playback.RecordDiagnostic(ctx, playback.DiagnosticStage{Stage: "resolver_fallback", Outcome: playback.OutcomeOK, Reason: appDiagnosticReason("webview_success")})
		return source, nil
	}
	if err == nil && source.URL == "" {
		playback.RecordDiagnostic(ctx, playback.DiagnosticStage{Stage: "webview_media_extract", Outcome: playback.OutcomeNoURL, Reason: appDiagnosticReason("media_not_found")})
	}
	var restricted *discovery.PlatformError
	if err != nil && errors.As(err, &restricted) && restricted.Restricted {
		playback.RecordDiagnostic(ctx, playback.DiagnosticStage{Stage: "resolver_fallback", Outcome: playback.OutcomeRestricted, Reason: appDiagnosticReason("fallback_blocked_restricted")})
		return playback.Source{}, playback.WrapDiagnostic(err, trace, playback.DiagnosticSummary(trace.Snapshot().Stages))
	}
	if err != nil && (errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil) {
		outcome, reason := playback.OutcomeTimeout, "fallback_blocked_timeout"
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			outcome, reason = playback.OutcomeException, "fallback_blocked_cancelled"
		}
		playback.RecordDiagnostic(ctx, playback.DiagnosticStage{Stage: "resolver_fallback", Outcome: outcome, Reason: appDiagnosticReason(reason)})
		return playback.Source{}, playback.WrapDiagnostic(err, trace, playback.DiagnosticSummary(trace.Snapshot().Stages))
	}
	playback.RecordDiagnostic(ctx, playback.DiagnosticStage{Stage: "resolver_fallback", Outcome: playback.OutcomeOK, Reason: appDiagnosticReason("fallback_allowed")})
	source, err = ytdlpResolve(ctx, "https://www.douyin.com/video/"+id)
	if err != nil {
		return playback.Source{}, playback.WrapDiagnostic(err, trace, playback.DiagnosticSummary(trace.Snapshot().Stages))
	}
	source.Platform, source.Referer = "douyin", "https://www.douyin.com/video/"+id
	return source, nil
}

func appDiagnosticReason(value string) *string { return &value }

func summaryNoteID(contentID string) string {
	sum := sha256.Sum256([]byte("ai-summary-note:" + contentID))
	return hex.EncodeToString(sum[:16])
}
func containsTag(tags []string, target string) bool {
	for _, tag := range tags {
		if tag == target {
			return true
		}
	}
	return false
}

func summaryNotePoints(points []ai.SummaryPoint) []string {
	result := make([]string, 0, len(points))
	for index, point := range points {
		result = append(result, fmt.Sprintf("%d. %s", index+1, point.Text))
	}
	return result
}

// summaryNoteBody keeps the generated note useful outside the AI panel. New
// content-tree summaries preserve all five reading levels and their evidence;
// legacy summaries retain the previous format until they are regenerated.
func summaryNoteBody(result ai.SummaryResult) string {
	if result.Document != nil && len(result.Document.Sections) > 0 {
		return summaryNoteDocument(result.Document)
	}
	body := fmt.Sprintf("# AI 摘要\n\n%s\n\n## 要点\n\n%s", result.Overview, strings.Join(summaryNotePoints(result.Points), "\n"))
	if len(result.Outline) > 0 {
		body += "\n\n## 大纲\n\n" + strings.Join(summaryNoteOutline(result.Outline, 0), "\n")
	}
	return body
}

func summaryNoteDocument(document *ai.SummaryDocument) string {
	lines := []string{"# AI 主题地图", ""}
	if strings.TrimSpace(document.Topic) != "" {
		lines = append(lines, "## Topic", "", document.Topic, "")
	}
	for _, section := range document.Sections {
		summaryNoteSection(&lines, section, 2)
	}
	return strings.TrimRight(strings.Join(lines, "\n"), "\n")
}

func summaryNoteSection(lines *[]string, section ai.SummarySection, headingLevel int) {
	if strings.TrimSpace(section.Title) != "" {
		level := headingLevel
		if level < 2 {
			level = 2
		}
		if level > 6 {
			level = 6
		}
		*lines = append(*lines, strings.Repeat("#", level)+" "+section.Title, "")
	}
	if strings.TrimSpace(section.Topic) != "" {
		*lines = append(*lines, "**Topic:** "+section.Topic, "")
	}
	if strings.TrimSpace(section.Takeaway) != "" {
		*lines = append(*lines, "**Takeaway:** "+section.Takeaway, "")
	}
	if section.End > section.Start {
		*lines = append(*lines, fmt.Sprintf("时间：%.3f–%.3f 秒", section.Start, section.End), "")
	} else if section.Page > 0 {
		*lines = append(*lines, fmt.Sprintf("页码：第 %d 页", section.Page), "")
	}
	if evidence := summaryNoteEvidence(section.Evidence, section.Source); len(evidence) > 0 {
		*lines = append(*lines, "**证据：**")
		*lines = append(*lines, evidence...)
		*lines = append(*lines, "")
	}
	for _, unit := range section.Units {
		summaryNoteUnit(lines, unit)
	}
	for _, child := range section.Children {
		summaryNoteSection(lines, child, headingLevel+1)
	}
}

func summaryNoteUnit(lines *[]string, unit ai.SummaryUnit) {
	title := strings.TrimSpace(unit.Topic)
	if title == "" {
		title = strings.TrimSpace(unit.Takeaway)
	}
	if title == "" {
		title = "内容单元"
	}
	*lines = append(*lines, "### "+title, "")
	if strings.TrimSpace(unit.Takeaway) != "" {
		*lines = append(*lines, "**Takeaway:** "+unit.Takeaway, "")
	}
	if strings.TrimSpace(unit.Key) != "" {
		*lines = append(*lines, "**Key:** "+unit.Key, "")
	}
	if strings.TrimSpace(unit.Reason) != "" {
		*lines = append(*lines, "**Reason:** "+unit.Reason, "")
	}
	if len(unit.BriefSentenceIDs) > 0 && len(unit.Sentences) > 0 {
		briefIDs := make(map[string]bool, len(unit.BriefSentenceIDs))
		for _, id := range unit.BriefSentenceIDs {
			briefIDs[id] = true
		}
		*lines = append(*lines, "**Brief:**", "")
		for _, sentence := range unit.Sentences {
			if briefIDs[sentence.ID] && strings.TrimSpace(sentence.Text) != "" {
				*lines = append(*lines, "> "+sentence.Text)
			}
		}
		*lines = append(*lines, "")
	}
	if strings.TrimSpace(unit.Full) != "" {
		*lines = append(*lines, "**Full:**", "", unit.Full, "")
	}
	sentenceEvidence := make([][]ai.SummaryEvidence, 0, len(unit.Sentences))
	for _, sentence := range unit.Sentences {
		sentenceEvidence = append(sentenceEvidence, sentence.Evidence)
	}
	if evidence := summaryNoteEvidence(append([][]ai.SummaryEvidence{unit.Evidence, unit.Source}, sentenceEvidence...)...); len(evidence) > 0 {
		*lines = append(*lines, "**证据：**")
		*lines = append(*lines, evidence...)
		*lines = append(*lines, "")
	}
}

func summaryNoteEvidence(groups ...[]ai.SummaryEvidence) []string {
	seen := map[string]bool{}
	lines := make([]string, 0)
	for _, entries := range groups {
		for _, evidence := range entries {
			quote := strings.TrimSpace(evidence.Quote)
			if quote == "" {
				continue
			}
			key := fmt.Sprintf("%s\x00%d\x00%s\x00%.9f\x00%.9f\x00%d\x00%s", evidence.ID, evidence.Index, quote, evidence.Start, evidence.End, evidence.Page, strings.Join(evidence.CueIDs, ","))
			if seen[key] {
				continue
			}
			seen[key] = true
			location := ""
			if evidence.End > evidence.Start {
				location = fmt.Sprintf(" · %.3f–%.3f 秒", evidence.Start, evidence.End)
			} else if evidence.Page > 0 {
				location = fmt.Sprintf(" · 第 %d 页", evidence.Page)
			}
			lines = append(lines, fmt.Sprintf("- %s%s", quote, location))
		}
	}
	return lines
}

func summaryNoteOutline(nodes []ai.SummaryOutline, depth int) []string {
	result := make([]string, 0)
	for _, node := range nodes {
		result = append(result, strings.Repeat("  ", depth)+"- "+node.Title)
		result = append(result, summaryNoteOutline(node.Children, depth+1)...)
	}
	return result
}

// startBackgroundServices starts only work that must outlive the constructor.
// Keep this after all feature construction succeeds so a failed wiring path
// never leaves a refresh goroutine behind.
func startBackgroundServices(features *apiBundle, backupService *backup.Service) {
	features.sources.StartRefresh()
	backupService.StartScheduler()
}
