package discovery

import "tangentry/internal/content"

// Full platform items already live in the account-scoped recommendation queue;
// subscription items live in the inbox. Snapshots and the browser need cards,
// not another copy of every body and discussion accumulated while paging.
func projectBatchCandidates(candidates []batchCandidate) {
	for index := range candidates {
		item := content.Card(candidates[index].Item)
		if preview, truncated := content.TruncateRunes(item.PreviewText, content.CardDescriptionRunes); truncated {
			item.PreviewText = preview
			item.Partial = true
		}
		if item.Paper != nil {
			paper := *item.Paper
			for _, text := range []*string{&paper.Abstract, &paper.AISummary} {
				if prefix, truncated := content.TruncateRunes(*text, content.CardDescriptionRunes); truncated {
					*text = prefix
					item.Partial = true
				}
			}
			item.Paper = &paper
		}
		// Keep album order/count and the bounded image locators for card sizing.
		// Avoid retaining large per-image OCR descriptions in the list as well.
		copiedImages := false
		for imageIndex, image := range item.Images {
			if alt, truncated := content.TruncateRunes(image.Alt, 160); truncated {
				if !copiedImages {
					item.Images = append([]content.Image(nil), item.Images...)
					copiedImages = true
				}
				item.Images[imageIndex].Alt = alt
				item.Partial = true
			}
		}
		candidates[index].Item = item
	}
}
