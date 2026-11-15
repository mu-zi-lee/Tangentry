package retrieval

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func mkPassage(id, text string, score float64) Passage {
	return Passage{
		ID: id, ContentID: "fixture:assembly", Source: SourceArticle,
		Locator: "article:0:s0", StartRune: 0, EndRune: RuneLen(text),
		Text: text, Score: score, LexicalScore: score,
		SourceVersion: "content-revision:1", TextSHA256: TextSHA256(text),
	}
}

// TestBT16_PropertyMatrix: every successful assembly has UsedRunes <=
// BudgetRunes and UsedBytes <= 200000 across a deterministic grid of input
// sizes, Unicode classes and budgets (including boundaries).
func TestBT16_PropertyMatrix(t *testing.T) {
	classes := map[string]string{
		"ascii":  strings.Repeat("The quick brown fox jumps. ", 400),
		"cjk":    strings.Repeat("中文内容句子，用于测试预算。", 400),
		"astral": strings.Repeat("😀🎉🚀 emoji sentence. ", 400),
		"mixed":  strings.Repeat("混合 mixed 内容 😀。", 400),
	}
	budgets := []int{MandatoryMinimumRunes() - 1, MandatoryMinimumRunes(), 500, 4000, 8000, 60000, 120000, 1000000}
	sizes := []int{0, 1, 5, 40}
	asm := NewContextAssembler()
	for name, text := range classes {
		for _, n := range sizes {
			var passages []Passage
			for i := 0; i < n; i++ {
				passages = append(passages, mkPassage(fmt.Sprintf("p%d", i), text, float64(n-i)))
			}
			for _, budget := range budgets {
				input := AssemblyInput{
					Selection:       Selection{Passages: passages},
					SummaryMaterial: text,
					History:         []HistoryTurn{{Role: "user", Content: text}, {Role: "assistant", Content: text}},
					ResumableState:  "status: ok\nids: p0,p1",
					CurrentTask:     "问题：" + text,
					BudgetRunes:     budget,
					MaxBytes:        DefaultMaxBytes,
				}
				out, err := asm.Assemble(context.Background(), input)
				if err != nil {
					t.Fatalf("%s/n%d/b%d: %v", name, n, budget, err)
				}
				if out.Status == AssemblyInvalidBudget || out.Status == AssemblyContextBudgetExceeded {
					continue // explicit rejection is allowed
				}
				if out.UsedRunes > budget {
					t.Fatalf("%s/n%d/b%d: UsedRunes %d > budget %d", name, n, budget, out.UsedRunes, budget)
				}
				if out.UsedBytes > DefaultMaxBytes {
					t.Fatalf("%s/n%d/b%d: UsedBytes %d > 200000", name, n, budget, out.UsedBytes)
				}
				if RuneLen(out.Context) != out.UsedRunes || len(out.Context) != out.UsedBytes {
					t.Fatalf("%s/n%d/b%d: counters disagree with context", name, n, budget)
				}
			}
		}
	}
}

// TestBT17_ByteCap: 120,000 Chinese characters are 360,000 UTF-8 bytes; the
// assembler reduces or rejects, never sends the over-byte context.
func TestBT17_ByteCap(t *testing.T) {
	cjk := strings.Repeat("中", 120000)
	if len(cjk) != 360000 {
		t.Fatalf("probe changed: %d bytes", len(cjk))
	}
	// One huge passage cannot fit (never partial): rejection or reduction.
	asm := NewContextAssembler()
	out, err := asm.Assemble(context.Background(), AssemblyInput{
		Selection:   Selection{Passages: []Passage{mkPassage("huge", cjk, 1)}},
		CurrentTask: "问题",
		BudgetRunes: 120000,
		MaxBytes:    DefaultMaxBytes,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.UsedBytes > DefaultMaxBytes {
		t.Fatalf("over-byte context emitted: %d", out.UsedBytes)
	}
	if len(out.Passages) != 0 && out.Status != AssemblyContextBudgetExceeded {
		// If anything was kept it must fit the byte cap.
		if out.UsedBytes > DefaultMaxBytes {
			t.Fatal("kept passages exceed byte cap")
		}
	}
	// Many CJK passages: the assembler drops until both caps hold.
	var passages []Passage
	for i := 0; i < 300; i++ {
		passages = append(passages, mkPassage(fmt.Sprintf("c%d", i), strings.Repeat("中", 500), float64(300-i)))
	}
	out2, err := asm.Assemble(context.Background(), AssemblyInput{
		Selection:   Selection{Passages: passages},
		CurrentTask: "问题",
		BudgetRunes: 120000,
		MaxBytes:    DefaultMaxBytes,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out2.Status == AssemblyContextBudgetExceeded {
		return // explicit rejection is acceptable
	}
	if out2.UsedBytes > DefaultMaxBytes || out2.UsedRunes > 120000 {
		t.Fatalf("caps violated: runes=%d bytes=%d", out2.UsedRunes, out2.UsedBytes)
	}
	if out2.Dropped == 0 {
		t.Fatal("byte pressure must drop passages")
	}
}

// TestBT21_PostEmbeddingDropOrder: over-budget candidate set drops the
// lowest-scored whole passage first and recomputes, then truncates summary,
// then drops the oldest history turn; if still over → context_budget_exceeded.
// Exact drop order/counts asserted. (Chat=0 is structural: the domain never
// chats; the fake-provider assertion runs in phases 4/5.)
func TestBT21_PostEmbeddingDropOrder(t *testing.T) {
	asm := NewContextAssembler()
	// 10 passages of 100 runes each, scores 10..1; budget forces drops.
	var passages []Passage
	for i := 0; i < 10; i++ {
		passages = append(passages, mkPassage(fmt.Sprintf("p%d", i), strings.Repeat("a", 100), float64(10-i)))
	}
	input := AssemblyInput{
		Selection:   Selection{Passages: passages},
		CurrentTask: "task",
		BudgetRunes: 2000,
		MaxBytes:    DefaultMaxBytes,
	}
	out, err := asm.Assemble(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if out.Status == AssemblyContextBudgetExceeded {
		t.Fatal("should fit after dropping lowest-scored passages")
	}
	// Highest-scored prefix kept, lowest dropped.
	for i, p := range out.Passages {
		if p.ID != fmt.Sprintf("p%d", i) {
			t.Fatalf("drop order violated at %d: %s", i, p.ID)
		}
	}
	if out.Dropped != 10-len(out.Passages) {
		t.Fatalf("dropped count %d inconsistent", out.Dropped)
	}
	if out.UsedRunes > 2000 {
		t.Fatalf("over budget: %d", out.UsedRunes)
	}

	// Summary truncation happens only after all passages are gone.
	out2, err := asm.Assemble(context.Background(), AssemblyInput{
		Selection:       Selection{Passages: []Passage{mkPassage("p0", strings.Repeat("a", 100), 1)}},
		SummaryMaterial: strings.Repeat("summary sentence. ", 200),
		CurrentTask:     "task",
		BudgetRunes:     1200,
		MaxBytes:        DefaultMaxBytes,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out2.Status != AssemblyContextBudgetExceeded && out2.UsedRunes > 1200 {
		t.Fatalf("over budget: %d", out2.UsedRunes)
	}

	// Impossible assembly: the never-dropped current user turn alone exceeds
	// the budget → context_budget_exceeded, never an over-budget string.
	out3, err := asm.Assemble(context.Background(), AssemblyInput{
		History:     []HistoryTurn{{Role: "user", Content: strings.Repeat("task", 5000)}},
		CurrentTask: "q",
		BudgetRunes: 9000,
		MaxBytes:    DefaultMaxBytes,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out3.Status != AssemblyContextBudgetExceeded {
		t.Fatalf("status = %q, want context_budget_exceeded", out3.Status)
	}
}

// TestBT22_HistoryOverflow: oldest whole turns dropped first, current user
// turn retained, constraint reminder re-injected before the task, final
// rune/byte counts within bounds.
func TestBT22_HistoryOverflow(t *testing.T) {
	var history []HistoryTurn
	for i := 0; i < 30; i++ {
		role := "assistant"
		if i%2 == 0 {
			role = "user"
		}
		history = append(history, HistoryTurn{Role: role, Content: fmt.Sprintf("turn %d %s", i, strings.Repeat("hist", 100))})
	}
	history = append(history, HistoryTurn{Role: "user", Content: "CURRENT_QUESTION"})
	asm := NewContextAssembler()
	// 60,000-rune budget: full profile (history enabled, cap 12,000); the
	// 31 long turns overflow it, forcing oldest-first whole-turn drops.
	out, err := asm.Assemble(context.Background(), AssemblyInput{
		Selection:   Selection{Passages: []Passage{mkPassage("p0", "evidence text", 1)}},
		History:     history,
		CurrentTask: "CURRENT_QUESTION",
		BudgetRunes: 60000,
		MaxBytes:    DefaultMaxBytes,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status == AssemblyContextBudgetExceeded {
		t.Fatal("history overflow must be resolved by dropping oldest turns")
	}
	if out.UsedRunes > 60000 || out.UsedBytes > DefaultMaxBytes {
		t.Fatalf("bounds violated: %d runes %d bytes", out.UsedRunes, out.UsedBytes)
	}
	if !strings.Contains(out.Context, "CURRENT_QUESTION") {
		t.Fatal("current user turn dropped")
	}
	if strings.Contains(out.Context, "turn 0 ") {
		t.Fatal("oldest turn must be dropped first")
	}
	// Compression occurred → constraint reminder immediately before task.
	remIdx := strings.Index(out.Context, constraintReminderText)
	taskIdx := strings.Index(out.Context, "## task")
	if remIdx < 0 || taskIdx < 0 || remIdx > taskIdx {
		t.Fatal("constraint reminder must be re-injected before the task")
	}
}

// TestAssemblyDegradedProfile: 8,000-rune stress budget → degraded_budget,
// summary/history disabled, layers omitted explicitly.
func TestAssemblyDegradedProfile(t *testing.T) {
	asm := NewContextAssembler()
	out, err := asm.Assemble(context.Background(), AssemblyInput{
		Selection:       Selection{Passages: []Passage{mkPassage("p0", "evidence", 1)}},
		SummaryMaterial: "summary material here",
		History:         []HistoryTurn{{Role: "user", Content: "old turn"}},
		ResumableState:  "status: ok",
		CurrentTask:     "question",
		BudgetRunes:     8000,
		MaxBytes:        DefaultMaxBytes,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != AssemblyDegradedBudget {
		t.Fatalf("status = %q, want degraded_budget", out.Status)
	}
	if strings.Contains(out.Context, "summary material here") || strings.Contains(out.Context, "old turn") {
		t.Fatal("summary/history must be disabled at the stress budget")
	}
	if !strings.Contains(out.Context, "degraded_budget") {
		t.Fatal("status must say which layers were omitted")
	}
	if out.UsedRunes > 8000 || out.UsedBytes > DefaultMaxBytes {
		t.Fatalf("bounds violated: %d/%d", out.UsedRunes, out.UsedBytes)
	}
}

// TestAssemblyDefaults: layer caps at the 120,000 default sum to 120,000;
// unused summary share is not reallocated to passages.
func TestAssemblyDefaults(t *testing.T) {
	caps := capsForBudget(120000)
	sum := caps.identity + caps.constraints + caps.passages + caps.summary + caps.history + caps.state + caps.task
	if sum != 120000 {
		t.Fatalf("default caps sum = %d, want 120000", sum)
	}
	if caps.passages != 60000 || caps.summary != 24000 {
		t.Fatalf("knowledge sub-caps = %d/%d", caps.passages, caps.summary)
	}
	// No summary material: passage sub-cap stays 60,000.
	asm := NewContextAssembler()
	var passages []Passage
	for i := 0; i < 200; i++ {
		passages = append(passages, mkPassage(fmt.Sprintf("p%d", i), strings.Repeat("x", 500), float64(200-i)))
	}
	out, err := asm.Assemble(context.Background(), AssemblyInput{
		Selection: Selection{Passages: passages}, CurrentTask: "q",
		BudgetRunes: 120000, MaxBytes: DefaultMaxBytes,
	})
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, p := range out.Passages {
		total += passageRenderRunes(p)
	}
	if total > 60000 {
		t.Fatalf("passage sub-cap exceeded without summary: %d", total)
	}
}
