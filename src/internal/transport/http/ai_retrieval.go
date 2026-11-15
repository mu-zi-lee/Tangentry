package httptransport

import (
	"errors"
	"net/http"

	"tangentry/internal/retrieval"
)

// retrievalStatusError extracts a B retrieval StatusError, if any.
func retrievalStatusError(err error) (retrieval.StatusError, bool) {
	var se retrieval.StatusError
	if errors.As(err, &se) {
		return se, true
	}
	return retrieval.StatusError{}, false
}

// retrievalHTTPStatus maps each retrieval status to a distinct HTTP status.
// Outcome statuses (no_match, pdf_*, ...) are 200/202 with the status carried
// in the retrieval object; budget/input faults are 4xx. Never a generic
// provider error (B-T25).
func retrievalHTTPStatus(status string) int {
	switch status {
	case string(retrieval.SelectionInvalidBudget), string(retrieval.SelectionInvalidInput),
		string(retrieval.SelectionEmpty), retrieval.AssemblyContextBudgetExceeded:
		return http.StatusBadRequest
	case string(retrieval.SelectionStaleSource):
		return http.StatusConflict
	case string(retrieval.SelectionPDFExtracting):
		return http.StatusAccepted
	default:
		// no_match, no_verified_passages, source_unverified, pdf_no_text,
		// pdf_ocr_unavailable, pdf_extract_failed: renderable outcomes.
		return http.StatusOK
	}
}

// retrievalStatusCode is the distinct machine code for each status.
func retrievalStatusCode(status string) string { return "retrieval_" + status }

// retrievalStatusMessage is the distinct user-facing copy per status.
func retrievalStatusMessage(status string) string {
	switch status {
	case string(retrieval.SelectionInvalidBudget):
		return "检索预算无效，请检查上下文与嵌入预算设置。"
	case retrieval.AssemblyContextBudgetExceeded:
		return "上下文超出预算，无法组装检索结果；未发起对话请求。"
	case string(retrieval.SelectionNoMatch):
		return "未找到与问题相关的原文片段。"
	case string(retrieval.SelectionNoVerifiedPassages):
		return "候选片段均未通过原文校验，无可引用证据。"
	case string(retrieval.SelectionStaleSource):
		return "原文已更新，旧的引用已失效，请重新检索。"
	case string(retrieval.SelectionSourceInvalid):
		return "部分片段无法通过原文校验，已被丢弃。"
	case string(retrieval.SelectionPDFNoText):
		return "该 PDF 没有可用文本（可能为扫描件且未配置 OCR）。"
	case string(retrieval.SelectionPDFOCRUnavailable):
		return "本地 OCR 运行时不可用；请安装配置后重试，不会自动上传云端。"
	case string(retrieval.SelectionPDFExtracting):
		return "PDF 文本正在提取中，请稍后重试。"
	case string(retrieval.SelectionPDFExtractFail):
		return "PDF 文本提取失败，请重试或检查文件。"
	case string(retrieval.SelectionEmpty):
		return "问题为空，无法检索。"
	case string(retrieval.SelectionInvalidInput):
		return "输入包含非法字符，无法检索。"
	default:
		return "检索状态：" + status
	}
}

// writeRetrievalStatus writes a terminal retrieval outcome (zero chat POST).
// The retrieval object carries the distinct status; the body is never a
// generic provider error.
func writeRetrievalStatus(w http.ResponseWriter, status string, resp *retrieval.Response) {
	body := map[string]any{
		"code":    retrievalStatusCode(status),
		"message": retrievalStatusMessage(status),
		"status":  status,
	}
	if resp != nil {
		body["retrieval"] = resp
	}
	write(w, retrievalHTTPStatus(status), body)
}

// retrievalTerminal builds the SSE terminal frame for a rejected retrieval
// assembly. It carries the distinct status and retrieval object and is sent
// as a data frame, never event: done (B-T25).
func retrievalTerminal(se retrieval.StatusError, resp *retrieval.Response, partial string) map[string]any {
	terminal := map[string]any{
		"error":      retrievalStatusMessage(se.Status),
		"code":       retrievalStatusCode(se.Status),
		"status":     se.Status,
		"httpStatus": retrievalHTTPStatus(se.Status),
		"partial":    partial,
	}
	if resp != nil {
		terminal["retrieval"] = resp
	}
	return terminal
}
