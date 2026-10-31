package preferences

import (
	"context"
	"fmt"
)

const (
	ThemeKey              = "theme"
	AutomaticSubtitlesKey = "automatic_subtitles"
	CardAppearanceKey     = "card_appearance"
	FontSettingsKey       = "font_settings"
	MaxKeyLength          = 64
	MaxValueSize          = 256
)

// Store is the stable application-level preference port. Implementations must
// keep values outside browser origins so they survive a new loopback port.
type Store interface {
	Get(context.Context, string) (string, bool, error)
	Set(context.Context, string, string, ...int64) error
}

func ValidateKey(key string) error {
	if (key != ThemeKey && key != AutomaticSubtitlesKey && key != CardAppearanceKey && key != FontSettingsKey) || len(key) > MaxKeyLength {
		return fmt.Errorf("unsupported preference key %q", key)
	}
	return nil
}

func ValidateValue(value string) error {
	if len(value) > MaxValueSize {
		return fmt.Errorf("preference value exceeds %d bytes", MaxValueSize)
	}
	return nil
}

// Theme is the user's interface color preference. System resolves against
// the operating system appearance in the web view.
type Theme string

const (
	ThemeLight  Theme = "light"
	ThemeDark   Theme = "dark"
	ThemeSystem Theme = "system"
)

func (t Theme) Valid() bool {
	return t == ThemeLight || t == ThemeDark || t == ThemeSystem
}

// ParseTheme normalizes untrusted values to the safe default.
func ParseTheme(value string) Theme {
	theme := Theme(value)
	if theme.Valid() {
		return theme
	}
	return ThemeSystem
}
