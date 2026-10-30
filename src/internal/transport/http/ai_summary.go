package httptransport

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"tangentry/internal/ai"
)

func (h *aiHandler) aiSummaryInspect(w http.ResponseWriter, r *http.Request) {
	if !h.aiReady(w) {
		return
	}
	var input ai.SummaryInput
	if !decodeAIRequest(w, r, &input, ai.MaxInputBytes) {
		return
	}
	result, err := h.ai.AI.SummaryInspect(r.Context(), input)
	if err != nil {
		summaryFail(w, err)
		return
	}
	write(w, 200, result)
}

func (h *aiHandler) aiSummaryGenerate(w http.ResponseWriter, r *http.Request) {
	if !h.aiReady(w) {
		return
	}
	var input ai.SummaryInput
	if !decodeAIRequest(w, r, &input, ai.MaxInputBytes) {
		return
	}
	if err := setAILongWriteDeadline(w); err != nil && !errors.Is(err, http.ErrNotSupported) {
		summaryFail(w, ai.ErrProvider)
		return
	}
	result, err := h.ai.AI.SummaryGenerate(r.Context(), input)
	if err != nil {
		summaryFail(w, err)
		return
	}
	write(w, 200, result)
}

func (h *aiHandler) aiSummaryCached(w http.ResponseWriter, r *http.Request) {
	if !h.aiReady(w) {
		return
	}
	if len(r.URL.Query()) != 0 {
		summaryFail(w, ai.ErrInvalid)
		return
	}
	result, err := h.ai.AI.SummaryCached(r.Context(), r.PathValue("key"))
	if err != nil {
		summaryFail(w, err)
		return
	}
	write(w, 200, result)
}

func (h *aiHandler) aiSummaryTitles(w http.ResponseWriter, r *http.Request) {
	if !h.aiReady(w) {
		return
	}
	if len(r.URL.Query()) != 0 {
		summaryFail(w, ai.ErrInvalid)
		return
	}
	result, err := h.ai.AI.SummaryTitleOverrides(r.Context(), r.PathValue("key"))
	if err != nil {
		summaryFail(w, err)
		return
	}
	write(w, http.StatusOK, result)
}

func (h *aiHandler) aiSummaryTitlePut(w http.ResponseWriter, r *http.Request) {
	if !h.aiReady(w) {
		return
	}
	var input ai.SummaryTitleOverride
	if !decodeAIRequest(w, r, &input, 32<<10) {
		return
	}
	result, err := h.ai.AI.PutSummaryTitleOverride(r.Context(), r.PathValue("key"), input)
	if err != nil {
		summaryFail(w, err)
		return
	}
	write(w, http.StatusOK, result)
}

func (h *aiHandler) aiSummaryTitleDelete(w http.ResponseWriter, r *http.Request) {
	if !h.aiReady(w) {
		return
	}
	if len(r.URL.Query()) != 0 {
		summaryFail(w, ai.ErrInvalid)
		return
	}
	result, err := h.ai.AI.DeleteSummaryTitleOverride(r.Context(), r.PathValue("key"), r.PathValue("nodeID"))
	if err != nil {
		summaryFail(w, err)
		return
	}
	write(w, http.StatusOK, result)
}

func (h *aiHandler) aiChat(w http.ResponseWriter, r *http.Request) {
	if !h.aiReady(w) {
		return
	}
	var input ai.ChatRequest
	if !decodeAIRequest(w, r, &input, 512<<10) {
		return
	}
	if r.Header.Get("Accept") == "text/event-stream" {
		h.aiChatStream(w, r, input)
		return
	}
	result, err := h.ai.AI.Chat(r.Context(), input)
	if err != nil {
		chatFail(w, err)
		return
	}
	write(w, http.StatusOK, result)
}

func (h *aiHandler) aiChatStream(w http.ResponseWriter, r *http.Request, input ai.ChatRequest) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		result, err := h.ai.AI.Chat(r.Context(), input)
		if err != nil {
			chatFail(w, err)
			return
		}
		write(w, http.StatusOK, result)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	result, err := h.ai.AI.ChatStream(r.Context(), input, func(chunk string) error {
		payload, marshalErr := json.Marshal(map[string]string{"delta": chunk})
		if marshalErr != nil {
			return marshalErr
		}
		if _, writeErr := fmt.Fprintf(w, "data: %s\n\n", payload); writeErr != nil {
			return writeErr
		}
		flusher.Flush()
		return nil
	})
	if err != nil {
		payload, _ := json.Marshal(map[string]string{"error": aiErrorMessage(err)})
		_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
		return
	}
	payload, _ := json.Marshal(result)
	_, _ = fmt.Fprintf(w, "event: done\ndata: %s\n\n", payload)
	flusher.Flush()
}

func (h *aiHandler) aiChatHistory(w http.ResponseWriter, r *http.Request) {
	if !h.aiReady(w) {
		return
	}
	if len(r.URL.Query()) != 1 || r.URL.Query().Get("contentId") == "" {
		summaryFail(w, ai.ErrInvalid)
		return
	}
	result, err := h.ai.AI.ChatHistory(r.Context(), r.URL.Query().Get("contentId"))
	if err != nil {
		summaryFail(w, err)
		return
	}
	write(w, http.StatusOK, result)
}
