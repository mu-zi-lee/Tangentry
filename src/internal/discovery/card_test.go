package discovery

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"tangentry/internal/content"
)

func heavyBatchItem(id int) content.Item {
	item := batchItem("linuxdo", fmt.Sprint(id), "完整话题", "作者", 1)
	item.Kind = "article"
	item.Description = strings.Repeat("正文", 3000)
	item.ArticleBlocks = make([]content.ArticleBlock, 60)
	for index := range item.ArticleBlocks {
		item.ArticleBlocks[index] = content.ArticleBlock{Kind: "paragraph", Text: strings.Repeat("正文", 2000)}
	}
	item.Transcripts = []content.Transcript{{URL: "https://example.com/captions.vtt", Type: "text/vtt"}}
	item.Discussion = &content.Discussion{TopicID: item.PlatformID, TotalPosts: 1, LoadedPosts: 1, Posts: []content.DiscussionPost{{ID: 1, Number: 1, Username: "reader", Blocks: item.ArticleBlocks}}}
	return item
}

func TestBatchPersistsOnlyCardPayloadOnInitialAndContinuationPages(t *testing.T) {
	repository := &batchSnapshots{}
	service := NewBatchService(batchProviderFunc(func(_ context.Context, _ string, page int) (Feed, error) {
		return Feed{Items: []content.Item{heavyBatchItem(page)}, HasMore: page == 1}, nil
	}), nil, []string{"linuxdo"}, repository)
	request := BatchRequest{Size: 10, Seed: 123}
	for page := 1; page <= 2; page++ {
		response, err := service.Create(context.Background(), request)
		if err != nil {
			t.Fatal(err)
		}
		if len(response.Items) != 1 || !response.Items[0].Item.Partial || response.Items[0].Item.PlatformID != fmt.Sprint(page) {
			t.Fatalf("page %d did not preserve a readable card: %+v", page, response)
		}
		payload := repository.values[response.BatchID]
		if len(payload) > 12000 || strings.Contains(string(payload), "articleBlocks") || strings.Contains(string(payload), "transcripts") || strings.Contains(string(payload), "discussion") {
			t.Fatalf("page %d retained full bodies: %d bytes", page, len(payload))
		}
		request.Cursor = response.NextCursor
	}
}

func TestBatchProjectionPreservesSourceDataAndAlbumCount(t *testing.T) {
	item := heavyBatchItem(1)
	item.PreviewText = strings.Repeat("摘要", 2000)
	item.Images = []content.Image{{URL: "https://example.com/1.jpg", Alt: strings.Repeat("图片", 400)}, {URL: "https://example.com/2.jpg", Alt: strings.Repeat("图片", 400)}}
	item.Paper = &content.PaperMetadata{Abstract: strings.Repeat("a", 5000), AISummary: strings.Repeat("s", 5000)}
	candidates := []batchCandidate{{Item: item}}
	projectBatchCandidates(candidates)
	card := candidates[0].Item
	if len(card.Images) != len(item.Images) || card.Images[1].URL != item.Images[1].URL || len([]rune(card.Images[1].Alt)) != 160 {
		t.Fatal("album metadata lost or unbounded")
	}
	if len(card.PreviewText) > 3*content.CardDescriptionRunes || len(card.Paper.Abstract) != content.CardDescriptionRunes || len(card.Paper.AISummary) != content.CardDescriptionRunes {
		t.Fatal("card text unbounded")
	}
	if len(item.ArticleBlocks) != 60 || item.Discussion == nil || len([]rune(item.Images[1].Alt)) != 800 || len(item.Paper.Abstract) != 5000 {
		t.Fatal("projection mutated full local source")
	}
}

func BenchmarkBatchSnapshotPayload(b *testing.B) {
	full := []batchCandidate{{Item: heavyBatchItem(1)}}
	card := append([]batchCandidate(nil), full...)
	projectBatchCandidates(card)
	for name, candidates := range map[string][]batchCandidate{"full": full, "card": card} {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				payload, err := json.Marshal(batchSnapshot{Candidates: candidates})
				if err != nil {
					b.Fatal(err)
				}
				b.ReportMetric(float64(len(payload)), "payload-B")
			}
		})
	}
}
