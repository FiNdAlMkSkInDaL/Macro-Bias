/**
 * Shared text-sanitisation helpers for all social post dispatch paths.
 *
 * Every outgoing post – cron-generated or scheduled – should pass through
 * `sanitizeForSocial()` before being sent to X, Bluesky, or Telegram.
 */

/** Strip all Markdown emphasis: **, *, __, _ wrapping words */
export function stripMarkdown(text: string): string {
  // Replace **bold** / __bold__ first, then *italic* / _italic_
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1');
}

/** Remove newsletter-style section headers that leak into social copy. */
export function stripSectionHeaders(text: string): string {
  return text.replace(
    /\b(BOTTOM LINE|SECTOR BREAKDOWN|RISK CHECK|MODEL NOTES|MARKET BREAKDOWN)[:\s]*/g,
    '',
  );
}

/** Full sanitisation pipeline for outgoing social text. */
export function sanitizeForSocial(text: string): string {
  return stripSectionHeaders(stripMarkdown(text))
    .replace(/[^\S\n]+/g, ' ')   // collapse horizontal whitespace, preserve newlines
    .replace(/\n{3,}/g, '\n\n')  // max two consecutive newlines
    .trim();
}
