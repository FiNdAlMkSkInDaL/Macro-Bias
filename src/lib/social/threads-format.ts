import 'server-only';

import { sanitizeForSocial } from './sanitize';

const MACRO_BIAS_LINK_PATTERN = /(?:https?:\/\/)?(?:www\.)?macro-bias\.com[^\s]*/gi;

function normalizeMacroBiasUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  const trailingPunctuationMatch = trimmed.match(/[),.!?;:]+$/);
  const trailingPunctuation = trailingPunctuationMatch?.[0] ?? '';
  const withoutTrailingPunctuation = trailingPunctuation
    ? trimmed.slice(0, -trailingPunctuation.length)
    : trimmed;

  const withScheme = withoutTrailingPunctuation.startsWith('http')
    ? withoutTrailingPunctuation
    : `https://${withoutTrailingPunctuation}`;

  try {
    const parsed = new URL(withScheme);
    parsed.protocol = 'https:';
    parsed.hostname = 'www.macro-bias.com';

    // Cross-posted URLs should attribute Threads traffic correctly.
    if (!parsed.searchParams.get('utm_source') || parsed.searchParams.get('utm_source') === 'x') {
      parsed.searchParams.set('utm_source', 'threads');
    }

    if (parsed.searchParams.get('utm_medium') === 'social') {
      parsed.searchParams.set('utm_medium', 'organic_social');
    }

    return `${parsed.toString()}${trailingPunctuation}`;
  } catch {
    return rawUrl;
  }
}

function normalizeMacroBiasLinks(text: string) {
  return text.replace(MACRO_BIAS_LINK_PATTERN, (match) => normalizeMacroBiasUrl(match));
}

export function formatForThreads(text: string) {
  const sanitized = sanitizeForSocial(text);
  const normalized = normalizeMacroBiasLinks(sanitized);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return normalized;
  }

  const lastParagraph = paragraphs[paragraphs.length - 1];
  const isUrlOnlyCta = /^https?:\/\/\S+$/i.test(lastParagraph);

  if (isUrlOnlyCta) {
    paragraphs[paragraphs.length - 1] = `Get the full briefing: ${lastParagraph}`;
  }

  return paragraphs.join('\n\n');
}