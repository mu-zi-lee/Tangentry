package retrieval

// Preflight is the INV-04 feasibility check run BEFORE candidate generation,
// embedding, rerank or chat. A preflight-detectable failure starts zero
// requests of any kind. Detectable here: invalid budget values; a rune or
// byte budget below the mandatory minimum (constraint reminder plus one
// minimum viable passage and its locator, with the fixed identity and task).
func Preflight(budgetRunes, maxBytes int) error {
	if err := ValidateAssemblyBudgetInt(budgetRunes); err != nil {
		return err
	}
	if maxBytes <= 0 {
		maxBytes = DefaultMaxBytes
	}
	minRunes := MandatoryMinimumRunes()
	if budgetRunes < minRunes {
		return ErrContextBudgetExceeded
	}
	// Byte estimate: fixed ASCII layers plus one minimum passage worst-case
	// CJK (3 bytes/rune) and its locator markup.
	minBytes := len(identityText) + len(constraintReminderText) + passageMarkupRunes + 3
	if minBytes > maxBytes {
		return ErrContextBudgetExceeded
	}
	return nil
}
