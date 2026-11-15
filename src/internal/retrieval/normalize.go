package retrieval

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"unicode"
	"unicode/utf8"
)

// RuneLen counts Unicode code points (never bytes, never UTF-16 units).
func RuneLen(s string) int { return utf8.RuneCountInString(s) }

// TextSHA256 returns the 64-char lowercase hex SHA-256 of the exact text.
func TextSHA256(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// NormalizeMatch normalizes text for matching only: line endings to \n,
// Unicode lowercase, whitespace runs collapsed to one space, trimmed.
// The original text is always kept for locators and quotes (ADR-002
// assembly step 1). Full NFC is not applied in v1: the domain package is
// stdlib-only and fixtures use precomposed characters; this is recorded in
// the phase report.
func NormalizeMatch(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := false
	for _, r := range strings.ToLower(s) {
		if unicode.IsSpace(r) {
			if !prevSpace && b.Len() > 0 {
				b.WriteByte(' ')
			}
			prevSpace = true
			continue
		}
		prevSpace = false
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// NormalizeWhitespace collapses whitespace runs (including line endings) to
// single spaces without lowercasing; used for dedupe keys.
func NormalizeWhitespace(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := false
	for _, r := range s {
		if unicode.IsSpace(r) {
			if !prevSpace && b.Len() > 0 {
				b.WriteByte(' ')
			}
			prevSpace = true
			continue
		}
		prevSpace = false
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// ContainsNUL reports whether s contains a NUL byte (rejected input).
func ContainsNUL(s string) bool { return strings.ContainsRune(s, '\x00') }

// isCJK reports whether r is a CJK ideograph (common unified blocks).
func isCJK(r rune) bool {
	return (r >= 0x4E00 && r <= 0x9FFF) || // CJK Unified Ideographs
		(r >= 0x3400 && r <= 0x4DBF) || // Extension A
		(r >= 0xF900 && r <= 0xFAFF) // Compatibility Ideographs
}

// isSentenceTerminator reports the CJK and Latin sentence terminators.
func isSentenceTerminator(r rune) bool {
	switch r {
	case '。', '！', '？', '；', '…', '.', '!', '?':
		return true
	}
	return false
}

// isClosingQuote reports runes that attach to the preceding sentence.
func isClosingQuote(r rune) bool {
	switch r {
	case '"', '\'', '」', '』', '）', ')', '】', '》', '’', '”':
		return true
	}
	return false
}
