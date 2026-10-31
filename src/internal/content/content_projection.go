package content

import "strings"

// CardDescriptionRunes bounds descriptions in card listings.
const CardDescriptionRunes = 1200

// TruncateRunes copies only a bounded prefix, without retaining the full source
// string or allocating a rune slice proportional to an article's length.
func TruncateRunes(text string, limit int) (string, bool) {
	count := 0
	for index := range text {
		if count >= limit {
			return strings.Clone(text[:index]), true
		}
		count++
	}
	return text, false
}

// Card returns the fields a content card shows, without article bodies.
func Card(item Item) Item {
	description, truncated := TruncateRunes(item.Description, CardDescriptionRunes)
	if len(item.ArticleBlocks) == 0 && len(item.Transcripts) == 0 && item.Discussion == nil && !truncated {
		return item
	}
	item.ArticleBlocks, item.Transcripts, item.Discussion, item.Partial = nil, nil, nil, true
	if truncated {
		item.Description = description
	}
	return item
}

// Navigation-only feed labels are not article summaries.
func UsefulDescription(text string) bool {
	switch strings.ToLower(strings.TrimSpace(text)) {
	case "", "comments", "comment", "discussion", "read more", "阅读全文", "阅读原文", "查看评论", "评论":
		return false
	}
	return true
}
