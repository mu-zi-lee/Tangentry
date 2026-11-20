package citation

import "strings"

const streamCitationPrefix = "[[cite:"

// StreamFilter removes complete, valid citation markers from streamed text.
//
// It buffers only text that may be part of a citation marker. Ordinary text
// is returned immediately by Push.
//
// The original, unfiltered answer must still be accumulated separately by
// the caller and passed to Parse and Validate after generation completes.
type StreamFilter struct {
	pending strings.Builder
}

// NewStreamFilter creates a new incremental citation filter.
func NewStreamFilter() *StreamFilter {
	return &StreamFilter{}
}

// Push consumes one provider chunk and returns text that is safe to display.
//
// A valid citation marker is removed. A malformed marker is preserved,
// matching the behavior of Parse.
func (f *StreamFilter) Push(chunk string) string {
	if f == nil {
		return chunk
	}

	f.pending.WriteString(chunk)
	input := f.pending.String()
	f.pending.Reset()

	var output strings.Builder

	for len(input) > 0 {
		start := strings.Index(input, streamCitationPrefix)

		if start < 0 {
			// No complete prefix exists. Keep a possible partial prefix
			// at the end because it may continue in the next chunk.
			keep := longestCitationPrefixSuffix(input)
			output.WriteString(input[:len(input)-keep])

			if keep > 0 {
				f.pending.WriteString(input[len(input)-keep:])
			}
			break
		}

		// Text before the possible marker is ordinary display text.
		output.WriteString(input[:start])
		candidate := input[start:]

		end := strings.Index(candidate, "]]")
		if end < 0 {
			// Marker has started but is not complete. Wait for another chunk.
			f.pending.WriteString(candidate)
			break
		}

		end += len("]]")
		marker := candidate[:end]

		// Only remove a marker that matches the exact parser grammar.
		loc := citationPattern.FindStringIndex(marker)
		if loc != nil && loc[0] == 0 && loc[1] == len(marker) {
			// Valid citation marker: deliberately do not emit it.
		} else {
			// Malformed marker: preserve it as ordinary text.
			output.WriteString(marker)
		}

		input = candidate[end:]
	}

	return output.String()
}

// Flush returns any remaining buffered text.
//
// Call Flush only after the provider has completed successfully.
// Do not call it after a provider error or client disconnect, because
// the buffered text may be an incomplete citation marker.
func (f *StreamFilter) Flush() string {
	if f == nil {
		return ""
	}

	remaining := f.pending.String()
	f.pending.Reset()
	return remaining
}

// longestCitationPrefixSuffix returns the length of the longest suffix
// of s that is also a prefix of streamCitationPrefix.
//
// For example:
//
//	"hello[[ci" -> 4
//	"hello world" -> 0
func longestCitationPrefixSuffix(s string) int {
	max := len(streamCitationPrefix) - 1
	if len(s) < max {
		max = len(s)
	}

	for n := max; n > 0; n-- {
		if strings.HasSuffix(s, streamCitationPrefix[:n]) {
			return n
		}
	}

	return 0
}
