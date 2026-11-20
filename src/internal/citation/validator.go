package citation

import (
	"strconv"
	"strings"
	"unicode/utf8"

	"tangentry/internal/retrieval"
)

func Validate(
	contentID string,
	raw []RawCitation,
	passages []retrieval.Passage,
) []Citation {
	passageMap := make(map[string]retrieval.Passage, len(passages))

	for _, passage := range passages {
		passageMap[passage.ID] = passage
	}

	result := make([]Citation, 0, len(raw))

	for i, ref := range raw {
		citation := Citation{
			ID:        "citation-" + strconv.Itoa(i+1),
			PassageID: ref.PassageID,
			Quote:     ref.Quote,
			Status:    StatusInvalid,
		}

		passage, exists := passageMap[ref.PassageID]
		if !exists {
			citation.Reason = "passage not found in current retrieval"
			result = append(result, citation)
			continue
		}

		citation.ContentID = passage.ContentID
		citation.Source = string(passage.Source)
		citation.SourceVersion = passage.SourceVersion
		citation.Locator = passage.Locator

		if passage.ContentID != contentID {
			citation.Reason = "content ID mismatch"
			result = append(result, citation)
			continue
		}

		if passage.SourceVersion == "" {
			citation.Status = StatusUnverified
			citation.Reason = "source version unavailable"
			result = append(result, citation)
			continue
		}

		if ref.Quote == "" {
			citation.Reason = "empty quote"
			result = append(result, citation)
			continue
		}

		if !strings.Contains(passage.Text, ref.Quote) {
			citation.Reason = "quote does not exactly match source passage"
			result = append(result, citation)
			continue
		}

		byteOffset := strings.Index(passage.Text, ref.Quote)

		// Search from the next byte to detect even overlapping occurrences.
		secondOffset := strings.Index(
			passage.Text[byteOffset+1:],
			ref.Quote,
		)

		if secondOffset >= 0 {
			citation.Status = StatusAmbiguous
			citation.Reason = "quote appears more than once in source passage"
			result = append(result, citation)
			continue
		}
		runeOffset := utf8.RuneCountInString(passage.Text[:byteOffset])
		citation.StartRune = passage.StartRune + runeOffset
		citation.EndRune = citation.StartRune +
			utf8.RuneCountInString(ref.Quote)
		citation.Status = StatusVerified
		citation.Reason = ""

		result = append(result, citation)
	}

	return result
}
