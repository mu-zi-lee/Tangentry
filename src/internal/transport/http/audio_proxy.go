package httptransport

import (
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"tangentry/internal/netpolicy"
)

// audioProxy keeps feed media on the same origin as the reader. A number of
// podcast CDNs omit CORS headers or only honor browser Range requests
// inconsistently, while the browser's native audio element expects both.
func (h *mediaHandler) audioProxy(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if len(q) != 1 || q.Get("url") == "" {
		write(w, http.StatusBadRequest, apiError{"invalid_audio_url", "音频地址无效。"})
		return
	}
	raw, err := netpolicy.URL(q.Get("url"))
	if err != nil {
		write(w, http.StatusBadRequest, apiError{"invalid_audio_url", "音频地址无效。"})
		return
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		write(w, http.StatusBadRequest, apiError{"invalid_audio_url", "音频地址无效。"})
		return
	}
	client := h.audioHTTP
	if client == nil {
		write(w, http.StatusServiceUnavailable, apiError{"audio_unavailable", "音频代理暂时不可用。"})
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, raw, nil)
	if err != nil {
		write(w, http.StatusBadRequest, apiError{"invalid_audio_url", "音频地址无效。"})
		return
	}
	req.Header.Set("User-Agent", browserUserAgent)
	req.Header.Set("Accept", "audio/*,application/octet-stream;q=0.8,*/*;q=0.1")
	req.Header.Set("Accept-Encoding", "identity")
	if value := r.Header.Get("Range"); value != "" {
		req.Header.Set("Range", value)
	}
	response, err := client.Do(req)
	if err != nil {
		write(w, http.StatusBadGateway, apiError{"audio_unavailable", "音频暂时无法读取。"})
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent && response.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		write(w, http.StatusBadGateway, apiError{"audio_unavailable", "音频暂时无法读取。"})
		return
	}
	if response.StatusCode != http.StatusRequestedRangeNotSatisfiable && !audioContentType(response.Header.Get("Content-Type")) {
		write(w, http.StatusUnsupportedMediaType, apiError{"audio_unavailable", "来源没有返回可播放的音频。"})
		return
	}
	copyAudioHeader(w.Header(), response.Header)
	w.WriteHeader(response.StatusCode)
	if r.Method != http.MethodHead {
		_, _ = io.Copy(w, response.Body)
	}
}

func audioContentType(raw string) bool {
	typ, _, err := mime.ParseMediaType(raw)
	if err != nil {
		typ = strings.TrimSpace(strings.Split(raw, ";")[0])
	}
	typ = strings.ToLower(typ)
	return strings.HasPrefix(typ, "audio/") || typ == "application/octet-stream" || typ == "binary/octet-stream"
}

func copyAudioHeader(dst, src http.Header) {
	for _, key := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Cache-Control"} {
		if value := src.Values(key); len(value) > 0 {
			dst[key] = append([]string(nil), value...)
		}
	}
	dst.Set("Content-Disposition", "inline")
	dst.Set("X-Content-Type-Options", "nosniff")
}
