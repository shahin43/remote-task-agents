/**
 * Compose a user-facing failure summary that the board can render as a comment.
 * Prefer the structured worker summary, fall back to the raw error, and tag the
 * line so reviewers can spot the failure in a long task timeline.
 */
export function formatFailureSummary(summary: string | undefined, error: string | undefined): string {
  const trimmedSummary = summary?.trim();
  const trimmedError = error?.trim();
  if (trimmedSummary && trimmedError && !trimmedSummary.includes(trimmedError)) {
    return `Agent run failed: ${trimmedError}\n\n${trimmedSummary}`;
  }
  if (trimmedSummary) {
    return trimmedSummary.startsWith('Agent run failed')
      ? trimmedSummary
      : `Agent run failed: ${trimmedSummary}`;
  }
  if (trimmedError) return `Agent run failed: ${trimmedError}`;
  return 'Agent run failed without a recoverable summary. See the Output tab for the full session timeline.';
}
