package citation

import (
	"regexp"
	"strings"
)

var citationPattern = regexp.MustCompile(
	`\[\[cite:([^|\]]+)\|([^\]]+)\]\]`,
)

func Parse(answer string) (string, []RawCitation) {
	matches := citationPattern.FindAllStringSubmatch(answer, -1)

	citations := make([]RawCitation, 0, len(matches))

	for _, match := range matches {
		citations = append(citations, RawCitation{
			PassageID: strings.TrimSpace(match[1]),
			Quote:     match[2],
		})
	}

	cleanAnswer := citationPattern.ReplaceAllString(answer, "")
	cleanAnswer = strings.TrimSpace(cleanAnswer)

	return cleanAnswer, citations
}
