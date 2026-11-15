package httptransport

import (
	"errors"
	"net/http"

	"tangentry/internal/retrieval"
)

// retrievalSettingsGet returns the persisted embedding/rerank configuration,
// masked: the response carries hasKey/hasRerankKey, never a key.
func (h *aiHandler) retrievalSettingsGet(w http.ResponseWriter, r *http.Request) {
	if h.ai.RetrievalSettings == nil {
		write(w, 503, apiError{"ai_unavailable", "AI 功能暂不可用。"})
		return
	}
	if len(r.URL.Query()) != 0 {
		write(w, http.StatusBadRequest, apiError{"ai_unexpected_query", "AI 请求包含不支持的查询参数，请刷新页面后重试。"})
		return
	}
	settings, err := h.ai.RetrievalSettings.Get(r.Context())
	if err != nil {
		retrievalSettingsFail(w, err)
		return
	}
	write(w, http.StatusOK, settings)
}

// retrievalSettingsPut saves the configuration and applies it to the live
// engine. Keys are write-only: an omitted/empty key keeps the stored one.
func (h *aiHandler) retrievalSettingsPut(w http.ResponseWriter, r *http.Request) {
	if h.ai.RetrievalSettings == nil {
		write(w, 503, apiError{"ai_unavailable", "AI 功能暂不可用。"})
		return
	}
	var input retrieval.EmbeddingSettings
	if !decodeAIRequest(w, r, &input, 32<<10) {
		return
	}
	settings, err := h.ai.RetrievalSettings.Save(r.Context(), input)
	if err != nil {
		retrievalSettingsFail(w, err)
		return
	}
	write(w, http.StatusOK, settings)
}

// retrievalSettingsFail maps validation faults to an actionable 400 and
// storage faults to 503. Validation messages name the offending field only;
// provider bodies and keys never surface.
func retrievalSettingsFail(w http.ResponseWriter, err error) {
	if errors.Is(err, retrieval.ErrInvalidInput) || errors.Is(err, retrieval.ErrInvalidBudget) {
		write(w, http.StatusBadRequest, apiError{"invalid_retrieval_settings", err.Error()})
		return
	}
	write(w, http.StatusServiceUnavailable, apiError{"retrieval_settings_storage", "检索设置无法读写，请检查本机数据目录。"})
}
