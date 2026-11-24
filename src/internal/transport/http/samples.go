package httptransport

import "net/http"

// samplesHandler exposes the bundled starter library settings and actions.
type samplesHandler struct{ service SamplesService }

// samplesStatusGet reports the preference, whether the whole set is present and
// the per-item presence, so the UI can explain exactly what is there.
func (h *samplesHandler) samplesStatusGet(w http.ResponseWriter, r *http.Request) {
	if h.service == nil {
		write(w, http.StatusServiceUnavailable, apiError{"samples_unavailable", "示例资料暂不可用。"})
		return
	}
	if len(r.URL.Query()) != 0 {
		write(w, http.StatusBadRequest, apiError{"unexpected_query", "请求包含不支持的查询参数。"})
		return
	}
	status, err := h.service.Status(r.Context())
	if err != nil {
		write(w, http.StatusInternalServerError, apiError{"samples_status_failed", "无法读取示例资料状态。"})
		return
	}
	write(w, http.StatusOK, status)
}

// samplesSettingsPut toggles automatic seeding. Removal is deliberately a
// separate action so turning the offer off never deletes anything.
func (h *samplesHandler) samplesSettingsPut(w http.ResponseWriter, r *http.Request) {
	if h.service == nil {
		write(w, http.StatusServiceUnavailable, apiError{"samples_unavailable", "示例资料暂不可用。"})
		return
	}
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if !decodeAIRequest(w, r, &input, 4<<10) {
		return
	}
	if input.Enabled == nil {
		write(w, http.StatusBadRequest, apiError{"samples_invalid", "请提供 enabled 字段。"})
		return
	}
	status, err := h.service.SetEnabled(r.Context(), *input.Enabled)
	if err != nil {
		write(w, http.StatusInternalServerError, apiError{"samples_save_failed", "无法保存示例资料设置。"})
		return
	}
	write(w, http.StatusOK, status)
}

// samplesLoad imports any missing bundled document now.
func (h *samplesHandler) samplesLoad(w http.ResponseWriter, r *http.Request) {
	if h.service == nil {
		write(w, http.StatusServiceUnavailable, apiError{"samples_unavailable", "示例资料暂不可用。"})
		return
	}
	if len(r.URL.Query()) != 0 {
		write(w, http.StatusBadRequest, apiError{"unexpected_query", "请求包含不支持的查询参数。"})
		return
	}
	status, err := h.service.Load(r.Context())
	if err != nil {
		write(w, http.StatusInternalServerError, apiError{"samples_load_failed", "示例资料载入失败，请检查本机数据目录。"})
		return
	}
	write(w, http.StatusOK, status)
}

// samplesRemove deletes the bundled documents from the library. It marks
// seeding as done, so an explicit removal is not undone automatically.
func (h *samplesHandler) samplesRemove(w http.ResponseWriter, r *http.Request) {
	if h.service == nil {
		write(w, http.StatusServiceUnavailable, apiError{"samples_unavailable", "示例资料暂不可用。"})
		return
	}
	if len(r.URL.Query()) != 0 {
		write(w, http.StatusBadRequest, apiError{"unexpected_query", "请求包含不支持的查询参数。"})
		return
	}
	status, err := h.service.Remove(r.Context())
	if err != nil {
		write(w, http.StatusInternalServerError, apiError{"samples_remove_failed", "示例资料移除失败，请重试。"})
		return
	}
	write(w, http.StatusOK, status)
}
