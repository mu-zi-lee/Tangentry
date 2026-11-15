// Command vectorgen is the ONE live embedding pass for the eval-b Phase-7
// evaluation. It generates frozen vectors for the fixed evaluation set using
// the real aichat.EmbeddingClient adapter, then every replay run is offline.
//
// Protocol §9 gate: this command REFUSES to run without an explicit human
// authorization statement (-authorize) covering provider, model, credentials,
// spend ceiling and network use. The API key is read at runtime from
// ~/.bailian/config.json (top-level api_key) and is NEVER written to any file
// or log. The request ledger records role/text_type/status/usage only.
//
// Run (after authorization):
//
//	cd test/offline/eval-b && go run ./vectorgen -eval . \
//	    -authorize "<human authorization statement>" -spend-cap-cny 10
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"tangentry/eval-b-gen/evalutil"
	"tangentry/internal/adapters/aichat"
	"tangentry/internal/retrieval"

	"go.yaml.in/yaml/v3"
)

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "FATAL: "+format+"\n", args...)
	os.Exit(1)
}

func check(cond bool, format string, args ...any) {
	if !cond {
		die(format, args...)
	}
}

// recordingTransport counts every request and records role/text_type/status/
// usage. It never logs Authorization headers, request texts or response
// vectors.
type recordingTransport struct {
	base   http.RoundTripper
	ledger []requestRecord
}

type requestRecord struct {
	Seq         int    `json:"seq"`
	Role        string `json:"role"`
	TextType    string `json:"text_type"`
	Model       string `json:"model"`
	BatchSize   int    `json:"batch_size"`
	HTTPStatus  int    `json:"http_status"`
	TotalTokens int    `json:"total_tokens"`
	Error       string `json:"error,omitempty"`
}

func (t *recordingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	rec := requestRecord{Seq: len(t.ledger) + 1}
	if req.Body != nil {
		body, _ := io.ReadAll(req.Body)
		req.Body = io.NopCloser(bytes.NewReader(body))
		var payload struct {
			Model string `json:"model"`
			Input struct {
				Texts []string `json:"texts"`
			} `json:"input"`
			Parameters struct {
				TextType string `json:"text_type"`
			} `json:"parameters"`
		}
		if json.Unmarshal(body, &payload) == nil {
			rec.Model = payload.Model
			rec.BatchSize = len(payload.Input.Texts)
			rec.TextType = payload.Parameters.TextType
		}
	}
	resp, err := t.base.RoundTrip(req)
	if err != nil {
		rec.Error = "transport error (redacted)"
		t.ledger = append(t.ledger, rec)
		return resp, err
	}
	rec.HTTPStatus = resp.StatusCode
	if resp.Body != nil {
		body, _ := io.ReadAll(resp.Body)
		resp.Body = io.NopCloser(bytes.NewReader(body))
		var env struct {
			Usage struct {
				TotalTokens int `json:"total_tokens"`
			} `json:"usage"`
			Code string `json:"code"`
		}
		if json.Unmarshal(body, &env) == nil {
			rec.TotalTokens = env.Usage.TotalTokens
			if env.Code != "" {
				rec.Error = "provider code: " + env.Code
			}
		}
	}
	t.ledger = append(t.ledger, rec)
	return resp, nil
}

func loadAPIKey() string {
	home, err := os.UserHomeDir()
	check(err == nil, "home dir: %v", err)
	data, err := os.ReadFile(filepath.Join(home, ".bailian", "config.json"))
	check(err == nil, "read ~/.bailian/config.json: %v", err)
	var cfg struct {
		APIKey string `json:"api_key"`
	}
	check(json.Unmarshal(data, &cfg) == nil, "parse bailian config")
	check(strings.TrimSpace(cfg.APIKey) != "", "no top-level api_key in ~/.bailian/config.json (the token-plan key does NOT support embeddings)")
	return cfg.APIKey
}

func main() {
	evalDir := flag.String("eval", ".", "eval-b root")
	authorize := flag.String("authorize", "", "REQUIRED: explicit human authorization statement (provider/model/credentials/spend/network)")
	spendCap := flag.Float64("spend-cap-cny", 10, "spend ceiling in CNY for this pass")
	model := flag.String("model", "text-embedding-v4", "Bailian embedding model")
	dims := flag.Int("dims", 1024, "dimensions")
	batch := flag.Int("batch", 8, "batch size (<= model row limit)")
	flag.Parse()
	check(strings.TrimSpace(*authorize) != "",
		"protocol §9: explicit human authorization required (-authorize \"<statement>\"); refusing to make network calls")

	// Load the confirmed set + fixtures.
	data, err := os.ReadFile(filepath.Join(*evalDir, "questions.yaml"))
	check(err == nil, "read questions.yaml: %v", err)
	var set evalutil.EvalSet
	check(yaml.Unmarshal(data, &set) == nil, "parse questions.yaml")
	check(set.Status == "confirmed", "set not confirmed")

	type doc struct {
		id   string
		snap retrieval.Snapshot
	}
	var docs []doc
	fixtures, _ := filepath.Glob(filepath.Join(*evalDir, "fixtures", "*.json"))
	sort.Strings(fixtures)
	for _, f := range fixtures {
		snap, err := evalutil.LoadSnapshot(f)
		check(err == nil, "load %s: %v", f, err)
		if snap.ContentID == "fixture:article-empty" || snap.ContentID == "fixture:pdf-no-text" || snap.ContentID == "fixture:article-malicious" {
			continue // negative fixtures need no vectors
		}
		docs = append(docs, doc{snap.ContentID, snap})
	}

	// Collect texts: every candidate (document role) + every question in both
	// roles (query for split mode; document for the shared-mode simulation).
	docTexts := map[string]string{} // sha -> text
	queryTexts := map[string]string{}
	for _, d := range docs {
		for _, c := range evalutil.CandidatesOf(d.snap) {
			docTexts[evalutil.SHA256Hex(c.Text)] = c.Text
		}
	}
	for _, q := range set.Questions {
		queryTexts[evalutil.SHA256Hex(q.Question)] = q.Question
		docTexts[evalutil.SHA256Hex(q.Question)] = q.Question
	}
	ordered := func(m map[string]string) []string {
		keys := make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make([]string, 0, len(keys))
		for _, k := range keys {
			out = append(out, m[k])
		}
		return out
	}
	docList := ordered(docTexts)
	queryList := ordered(queryTexts)

	// Spend estimate (conservative: 1.5 tokens/rune, CNY 0.0005 per 1k tokens).
	runes := 0
	for _, t := range docList {
		runes += retrieval.RuneLen(t)
	}
	for _, t := range queryList {
		runes += retrieval.RuneLen(t)
	}
	estTokens := float64(runes) * 1.5
	estCNY := estTokens / 1000 * 0.0005
	fmt.Printf("texts: %d document + %d query; ~%.0f tokens; estimated cost ~CNY %.3f (cap %.2f)\n",
		len(docList), len(queryList), estTokens, estCNY, *spendCap)
	check(estCNY <= *spendCap, "estimated cost CNY %.3f exceeds spend cap %.2f; aborting", estCNY, *spendCap)

	settings := retrieval.EmbeddingSettings{
		ProviderKind: retrieval.ProviderBailian, Surface: retrieval.SurfaceDashScope,
		BaseURL: "https://dashscope.aliyuncs.com", APIKey: loadAPIKey(),
		Model: *model, Dimensions: *dims, BatchSize: *batch,
		EncodingFormat: retrieval.EncodingFloat, TimeoutMs: 60000, TopK: 100,
		LexicalWeight: 0.35, EmbeddingWeight: 0.65,
		MaxEmbeddingRequests: 4000, MaxEmbeddingChars: 5000000,
	}
	check(retrieval.ValidateEmbeddingSettings(settings) == nil, "invalid embedding settings")

	rec := &recordingTransport{base: http.DefaultTransport}
	budget := retrieval.NewBudgetTracker(settings.MaxEmbeddingRequests, settings.MaxEmbeddingChars)
	client := aichat.NewEmbeddingClient(settings, budget, nil)
	client.HTTP = &http.Client{Transport: rec}

	ctx := context.Background()
	started := time.Now().UTC().Format(time.RFC3339)

	// Connection probe first (fixed harmless string; never a user document).
	probe, err := client.TestConnection(ctx)
	check(err == nil, "embedding connection test failed (key may lack embedding permission): %v", err)
	check(probe.OK, "connection test dimension mismatch: got %d want %d", probe.Dimensions, *dims)
	fmt.Printf("connection test OK: model=%s dims=%d\n", probe.Model, probe.Dimensions)

	store := &evalutil.VectorStore{
		Schema: 1, Model: *model, ProviderKind: retrieval.ProviderBailian,
		Surface: retrieval.SurfaceDashScope, Dimensions: *dims, BatchSize: *batch,
		GeneratedAt: started, Document: map[string]string{}, Query: map[string]string{},
	}

	embedAll := func(texts []string, role retrieval.EmbedRole, dst map[string]string) {
		for start := 0; start < len(texts); start += *batch {
			end := start + *batch
			if end > len(texts) {
				end = len(texts)
			}
			chunk := texts[start:end]
			var vecs [][]float32
			var err error
			for attempt := 0; attempt < 2; attempt++ {
				vecs, err = client.Embed(ctx, chunk, role)
				if err == nil {
					break
				}
				fmt.Fprintf(os.Stderr, "batch %d role=%s attempt %d failed: %v\n", start, role, attempt+1, err)
				time.Sleep(2 * time.Second)
			}
			check(err == nil, "embedding batch failed permanently (role=%s start=%d): %v; NO partial vectors written", role, start, err)
			check(len(vecs) == len(chunk), "vector count mismatch")
			for i, t := range chunk {
				dst[evalutil.SHA256Hex(t)] = evalutil.EncodeVector(vecs[i])
			}
			if (start/(*batch))%50 == 0 {
				fmt.Printf("progress role=%s: %d/%d texts\n", role, end, len(texts))
			}
		}
	}
	embedAll(docList, retrieval.EmbedDocument, store.Document)
	embedAll(queryList, retrieval.EmbedQuery, store.Query)

	vecDir := filepath.Join(*evalDir, "vectors")
	check(os.MkdirAll(vecDir, 0o755) == nil, "mkdir vectors")
	check(store.Save(filepath.Join(vecDir, "frozen-vectors.json")) == nil, "save frozen vectors")

	totalTokens := 0
	for _, r := range rec.ledger {
		totalTokens += r.TotalTokens
	}
	log := map[string]any{
		"authorization_statement": *authorize,
		"authorized_at":           started,
		"spend_cap_cny":           *spendCap,
		"estimated_cost_cny":      estCNY,
		"provider_kind":           settings.ProviderKind,
		"endpoint_family":         "dashscope.aliyuncs.com (DashScope text-embedding surface)",
		"settings_masked":         settings.Mask(),
		"key_source":              "~/.bailian/config.json top-level api_key (REDACTED, never logged)",
		"connection_probe":        probe,
		"request_count":           len(rec.ledger),
		"total_tokens":            totalTokens,
		"budget_requests":         budget.Requests(),
		"budget_chars":            budget.Chars(),
		"budget_status":           budget.Status(),
		"document_vectors":        len(store.Document),
		"query_vectors":           len(store.Query),
		"vector_sha256":           store.VectorSHA256,
		"requests":                rec.ledger,
		"finished_at":             time.Now().UTC().Format(time.RFC3339),
	}
	lg, _ := json.MarshalIndent(log, "", "  ")
	check(os.WriteFile(filepath.Join(vecDir, "generation-log.json"), append(lg, '\n'), 0o644) == nil, "write generation log")

	fmt.Printf("DONE: %d requests, %d tokens, %d document + %d query vectors, vector hash %s\n",
		len(rec.ledger), totalTokens, len(store.Document), len(store.Query), store.VectorSHA256)
	fmt.Println("All replay runs are now offline (frozen vectors). The key was never written to disk.")
}
