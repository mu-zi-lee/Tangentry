package httptransport

import (
	"net/http"
	"strings"
	"time"

	"tangentry/internal/retrieval"
)

// retrievalSearchInput is the standalone workbench request. The optional
// retrieval fragment only tightens the saved budgets, exactly as in chat;
// the workbench always runs retrieval, so Enabled is server-owned.
type retrievalSearchInput struct {
	ContentID string             `json:"contentId"`
	Question  string             `json:"question"`
	Retrieval *retrieval.Request `json:"retrieval"`
}

// retrievalSearchPassage carries the verifiable reference plus the exact text
// and scores the workbench displays. A locator is not proof (ADR-002).
type retrievalSearchPassage struct {
	retrieval.PassageRef
	Text         string  `json:"text"`
	Score        float64 `json:"score"`
	LexicalScore float64 `json:"lexicalScore"`
	CosineScore  float64 `json:"cosineScore"`
}

type retrievalSearchResponse struct {
	Retrieval    retrieval.Response       `json:"retrieval"`
	Passages     []retrievalSearchPassage `json:"passages"`
	ContextChars int                      `json:"contextChars"`
	// ElapsedMs is the server-side selection time for this search (additive).
	ElapsedMs int64 `json:"elapsedMs"`
}

// retrievalSearchPost runs B's selection/assembly pipeline without starting a
// chat request. It reuses the same engine, status mapping and copy as the chat
// path, so the workbench cannot report an outcome chat would not report.
func (h *aiHandler) retrievalSearchPost(w http.ResponseWriter, r *http.Request) {
	if h.ai.Retrieval == nil {
		write(w, 503, apiError{"ai_unavailable", "AI 功能暂不可用。"})
		return
	}
	var input retrievalSearchInput
	if !decodeAIRequest(w, r, &input, 64<<10) {
		return
	}
	if strings.TrimSpace(input.ContentID) == "" {
		write(w, http.StatusBadRequest, apiError{"retrieval_content_required", "请先选择要检索的内容。"})
		return
	}
	request := retrieval.Request{SchemaVersion: retrieval.WireSchemaVersion, Enabled: true}
	if input.Retrieval != nil {
		request = *input.Retrieval
		request.SchemaVersion = retrieval.WireSchemaVersion
		request.Enabled = true
	}
	started := time.Now()
	result, err := h.ai.Retrieval.Run(r.Context(), retrieval.RunInput{
		ContentID: input.ContentID,
		Question:  input.Question,
		Request:   request,
	})
	if err != nil {
		if se, ok := retrievalStatusError(err); ok {
			resp := result.Response
			writeRetrievalStatus(w, se.Status, &resp)
			return
		}
		write(w, http.StatusServiceUnavailable, apiError{"retrieval_unavailable", "检索暂时不可用，请检查本机数据目录与检索设置。"})
		return
	}
	passages := make([]retrievalSearchPassage, 0, len(result.Passages))
	for _, p := range result.Passages {
		passages = append(passages, retrievalSearchPassage{
			PassageRef:   retrieval.RefFromPassage(p),
			Text:         p.Text,
			Score:        p.Score,
			LexicalScore: p.LexicalScore,
			CosineScore:  p.CosineScore,
		})
	}
	write(w, http.StatusOK, retrievalSearchResponse{
		Retrieval:    result.Response,
		Passages:     passages,
		ContextChars: len([]rune(result.Context)),
		ElapsedMs:    time.Since(started).Milliseconds(),
	})
}
