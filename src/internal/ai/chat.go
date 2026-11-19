package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"tangentry/internal/citation"
	"tangentry/internal/retrieval"
)

const chatResultKind = "chat"

func chatKey(contentID string) string {
	return hashSource(struct{ Kind, ContentID string }{chatResultKind, contentID})
}

func (s *Service) ChatHistory(ctx context.Context, contentID string) (ChatResult, error) {
	if !contentIDValid(contentID) {
		return ChatResult{}, ErrInvalid
	}
	row, err := s.results.AIResult(ctx, chatResultKind, chatKey(contentID), "")
	if errors.Is(err, ErrNotFound) {
		return ChatResult{ContentID: contentID, Messages: []ChatMessage{}}, nil
	}
	if err != nil {
		return ChatResult{}, ErrStorage
	}
	var messages []ChatMessage
	if len(row.Value) > 512<<10 || json.Unmarshal([]byte(row.Value), &messages) != nil || !utf8ValidChat("", messages) {
		return ChatResult{}, ErrStorage
	}
	return ChatResult{ContentID: contentID, Messages: messages, UpdatedAt: row.CreatedAt}, nil
}

func (s *Service) Chat(ctx context.Context, in ChatRequest) (ChatResult, error) {
	return s.chat(ctx, in, nil)
}

// ChatStream stores the completed answer while forwarding deltas to emit. A
// provider without streaming support transparently emits one final chunk.
func (s *Service) ChatStream(ctx context.Context, in ChatRequest, emit func(string) error) (ChatResult, error) {
	return s.chat(ctx, in, emit)
}

func (s *Service) chat(ctx context.Context, in ChatRequest, emit func(string) error) (ChatResult, error) {
	if !validBudgetLimit(in.MaxProviderCalls) {
		return ChatResult{}, ErrInvalid
	}
	// When retrieval is enabled the client-supplied context is ignored (the
	// server reads the source by contentId); only messages are validated.
	contextToValidate := in.Context
	if in.Retrieval != nil && in.Retrieval.Enabled {
		contextToValidate = ""
	}
	if !contentIDValid(in.ContentID) || !utf8ValidChat(contextToValidate, in.Messages) || len(in.Messages) > 40 {
		return ChatResult{}, ErrInvalid
	}
	s.mu.Lock()
	c, provider := s.config, s.provider
	s.mu.Unlock()
	if in.Model != "" {
		c.Model = in.Model
	} else {
		c.Model = chatModel(c)
	}
	if !ValidModelName(c.Model) || (len(c.EnabledModels) > 0 && !containsModel(c.EnabledModels, c.Model)) {
		return ChatResult{}, ErrInvalid
	}
	if in.Revision != c.Revision {
		return ChatResult{}, ErrConflict
	}
	chatter, ok := provider.(Chatter)
	if !ok || !public(c).Ready {
		return ChatResult{}, ErrNotReady
	}
	// A budget is attached only for an explicit limit. Cache reads and history
	// clear make no completion POST and therefore consume no slot.
	ctx, err := withBudget(ctx, in.MaxProviderCalls)
	if err != nil {
		return ChatResult{}, err
	}
	key := chatKey(in.ContentID)
	if in.Clear {
		if err := s.results.DeleteAIResult(ctx, chatResultKind, key, ""); err != nil {
			return ChatResult{}, ErrStorage
		}
		return ChatResult{ContentID: in.ContentID, Messages: []ChatMessage{}, Budget: budgetReportFor(ctx)}, nil
	}
	var history []ChatMessage
	if row, err := s.results.AIResult(ctx, chatResultKind, key, ""); err == nil {
		_ = json.Unmarshal([]byte(row.Value), &history)
	} else if !errors.Is(err, ErrNotFound) {
		return ChatResult{}, ErrStorage
	}
	if len(in.Messages) > 0 {
		history = append([]ChatMessage(nil), in.Messages...)
	}
	if len(history) == 0 || history[len(history)-1].Role != "user" {
		return ChatResult{}, ErrInvalid
	}
	// Retrieval branch (B): when enabled, run the server-side pipeline BEFORE
	// any chat POST. The assembled six-layer context becomes the provider
	// system-message source; the client context is ignored. A rejection
	// returns zero chat requests (INV-04).
	source := in.Context
	var retrievalResp *retrieval.Response
	var citationPassages []retrieval.Passage
	if in.Retrieval != nil && in.Retrieval.Enabled {
		s.mu.Lock()
		engine := s.retrievalEngine
		s.mu.Unlock()
		if engine == nil {
			return ChatResult{}, ErrNotReady
		}
		turns := make([]retrieval.HistoryTurn, 0, len(history))
		for _, m := range history {
			turns = append(turns, retrieval.HistoryTurn{Role: m.Role, Content: m.Content})
		}
		runResult, rerr := engine.Run(ctx, retrieval.RunInput{
			ContentID: in.ContentID,
			Question:  retrieval.LastUserQuestion(turns),
			Request:   *in.Retrieval,
			History:   turns,
		})
		retrievalResp = &runResult.Response
		if rerr != nil {
			return ChatResult{ContentID: in.ContentID, Retrieval: retrievalResp}, rerr
		}
		source = runResult.Context
		citationPassages = runResult.Passages
	}

	var answer string
	streamCompleted := false

	if stream, ok := provider.(StreamChatter); ok && emit != nil {
		var builder strings.Builder
		var downstreamErr error
		filter := citation.NewStreamFilter()

		streamErr := stream.ChatStream(
			ctx,
			c,
			source,
			history,
			func(chunk string) error {
				// 保存未经处理的原始答案，供后续 Parse 和 Validate 使用。
				builder.WriteString(chunk)

				// 过滤引用标记，只输出可以安全展示的文本。
				visible := filter.Push(chunk)

				// 请求取消时，立即停止向下游输出。
				if ctx.Err() != nil {
					downstreamErr = ctx.Err()
					return downstreamErr
				}

				if visible != "" {
					if emitErr := emit(visible); emitErr != nil {
						downstreamErr = emitErr
						return emitErr
					}
				}

				return nil
			},
		)

		if streamErr != nil {
			// 客户端断开或下游输出失败：不允许 fallback，也不保存历史。
			if downstreamErr != nil || ctx.Err() != nil {
				failure := downstreamErr
				if failure == nil {
					failure = ctx.Err()
				}

				SetOutcome(ctx, terminalOutcome(failure))
				MarkInvocationFailed(ctx, terminalOutcome(failure))

				return ChatResult{
					Budget: budgetReportFor(ctx),
				}, failure
			}

			// 只有没有生成任何内容，并且错误允许 fallback 时才尝试非流式请求。
			if builder.Len() == 0 && fallbackAllowed(ctx, streamErr) {
				answer, err = chatter.Chat(ctx, c, source, history)
				if err != nil {
					if terminal := terminalOutcome(err); terminal != OutcomeActive {
						SetOutcome(ctx, terminal)
						MarkInvocationFailed(ctx, terminal)
					}

					return ChatResult{
						Budget: budgetReportFor(ctx),
					}, err
				}
			} else {
				SetOutcome(ctx, terminalOutcome(streamErr))
				MarkInvocationFailed(ctx, terminalOutcome(streamErr))

				return ChatResult{
					Budget: budgetReportFor(ctx),
				}, streamErr
			}
		} else {
			// Provider 正常结束后，才输出过滤器中剩余的文本。
			tail := filter.Flush()

			if tail != "" {
				if ctx.Err() != nil {
					failure := ctx.Err()
					SetOutcome(ctx, terminalOutcome(failure))
					MarkInvocationFailed(ctx, terminalOutcome(failure))

					return ChatResult{
						Budget: budgetReportFor(ctx),
					}, failure
				}

				if emitErr := emit(tail); emitErr != nil {
					SetOutcome(ctx, terminalOutcome(emitErr))
					MarkInvocationFailed(ctx, terminalOutcome(emitErr))

					return ChatResult{
						Budget: budgetReportFor(ctx),
					}, emitErr
				}
			}

			answer = builder.String()
			streamCompleted = true
		}
	} else {
		answer, err = chatter.Chat(ctx, c, source, history)
		if err != nil {
			if terminal := terminalOutcome(err); terminal != OutcomeActive {
				SetOutcome(ctx, terminal)
				MarkInvocationFailed(ctx, terminal)
			}

			return ChatResult{
				Budget: budgetReportFor(ctx),
			}, err
		}
	}

	if strings.TrimSpace(answer) == "" {
		SetOutcome(ctx, OutcomeProviderError)
		return ChatResult{Budget: budgetReportFor(ctx)}, ErrProvider
	}
	var citations []citation.Citation

	cleanAnswer, rawCitations := citation.Parse(answer)

	citations = citation.Validate(
		in.ContentID,
		rawCitations,
		citationPassages,
	)

	if err := ctx.Err(); err != nil {
		return ChatResult{
			Budget: budgetReportFor(ctx),
		}, err
	}

	// 非流式请求或 fallback 请求：在保存历史之前发送完整答案。
	// 正常流式请求已经逐 chunk 发送，不得再次发送整段答案。
	if emit != nil && !streamCompleted {
		if err := ctx.Err(); err != nil {
			return ChatResult{
				Budget: budgetReportFor(ctx),
			}, err
		}

		if cleanAnswer != "" {
			if emitErr := emit(cleanAnswer); emitErr != nil {
				SetOutcome(ctx, terminalOutcome(emitErr))
				MarkInvocationFailed(ctx, terminalOutcome(emitErr))

				return ChatResult{
					Budget: budgetReportFor(ctx),
				}, emitErr
			}
		}
	}

	history = append(history, ChatMessage{Role: "assistant", Content: strings.TrimSpace(cleanAnswer), Model: c.Model, Citations: citations})
	value, _ := json.Marshal(history)
	if err := s.results.PutAIResult(ctx, StoredResult{Kind: chatResultKind, SourceHash: key, Value: string(value), Target: "", Model: c.Model, CreatedAt: time.Now().Unix()}); err != nil {
		return ChatResult{}, ErrStorage
	}

	SetOutcome(ctx, OutcomeCompleted)
	return ChatResult{ContentID: in.ContentID, Messages: history, UpdatedAt: time.Now().Unix(), Budget: budgetReportFor(ctx), Retrieval: retrievalResp}, nil
}

func containsModel(models []string, model string) bool {
	for _, value := range models {
		if value == model {
			return true
		}
	}
	return false
}

func utf8ValidChat(contextText string, messages []ChatMessage) bool {
	if len(contextText) > 200000 || strings.ContainsAny(contextText, "\x00") {
		return false
	}
	for _, message := range messages {
		if (message.Role != "user" && message.Role != "assistant") || strings.TrimSpace(message.Content) == "" || len(message.Content) > 12000 {
			return false
		}
	}
	return true
}

func chatContext(content string, history []ChatMessage) string {
	return fmt.Sprintf("内容上下文：\n%s\n\n对话：%v", content, history)
}
