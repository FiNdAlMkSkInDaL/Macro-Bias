import 'server-only';

import { AtpAgent, RichText } from '@atproto/api';

const MAX_BLUESKY_GRAPHEME_LENGTH = 300;

type BlueskyEnvName = 'BLUESKY_IDENTIFIER' | 'BLUESKY_APP_PASSWORD';

function getOptionalServerEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getRequiredBlueskyEnv(name: BlueskyEnvName) {
  const value = getOptionalServerEnv(name);

  if (!value) {
    throw new Error(`Missing required Bluesky environment variable: ${name}`);
  }

  return value;
}

export function isBlueskyConfigured() {
  return Boolean(getOptionalServerEnv('BLUESKY_IDENTIFIER') && getOptionalServerEnv('BLUESKY_APP_PASSWORD'));
}

async function createBlueskyAgent() {
  const deadlineAt = Date.now() + 20_000;
  const agent = new AtpAgent({ service: 'https://bsky.social', fetch: (input, init) => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error('Bluesky request budget exhausted');
    const timeout = AbortSignal.timeout(Math.min(12_000, remaining));
    return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  } });

  await agent.login({
    identifier: getRequiredBlueskyEnv('BLUESKY_IDENTIFIER'),
    password: getRequiredBlueskyEnv('BLUESKY_APP_PASSWORD'),
  });

  return agent;
}

function truncateToGraphemeLimit(text: string, maxGraphemes: number): string {
  const segmenter = new Intl.Segmenter();
  const graphemes = [...segmenter.segment(text)].map((s) => s.segment);

  if (graphemes.length <= maxGraphemes) return text;

  // Try to preserve the URL on the last line
  const lines = text.split('\n');
  const lastLine = lines[lines.length - 1].trim();
  const lastLineGraphemes = [...segmenter.segment(lastLine)].length;
  const ellipsis = '\u2026';
  // budget: ellipsis + '\n\n' + lastLine
  const availableForBody = maxGraphemes - 1 - 2 - lastLineGraphemes;

  if (availableForBody > 20 && lastLine.startsWith('http')) {
    const bodyLines = lines.slice(0, lines.findLastIndex((l) => l.trim().startsWith('http')));
    const bodyText = bodyLines.join('\n').trimEnd();
    const bodyGraphemes = [...segmenter.segment(bodyText)].map((s) => s.segment);
    const truncatedBody = bodyGraphemes.slice(0, availableForBody).join('') + ellipsis;
    return truncatedBody + '\n\n' + lastLine;
  }

  // Fallback: hard truncate
  return graphemes.slice(0, maxGraphemes - 1).join('') + '\u2026';
}

export type SocialImage = { data: Uint8Array; alt: string; url: string };

export async function publishToBluesky(content: string, image?: SocialImage): Promise<string | null> {
  const agent = await createBlueskyAgent();

  const preliminary = new RichText({ text: content });
  await preliminary.detectFacets(agent);

  const finalText =
    preliminary.graphemeLength > MAX_BLUESKY_GRAPHEME_LENGTH
      ? truncateToGraphemeLimit(content, MAX_BLUESKY_GRAPHEME_LENGTH)
      : content;

  if (finalText !== content) {
    console.warn(
      `[bluesky] Post truncated from ${preliminary.graphemeLength} to ${MAX_BLUESKY_GRAPHEME_LENGTH} graphemes.`,
    );
  }

  const richText = new RichText({ text: finalText });
  await richText.detectFacets(agent);

  if (image && (finalText !== content || image.data.byteLength > 2_000_000)) throw new Error('Chart post exceeds provider limits');
  const blob = image ? (await agent.uploadBlob(image.data, { encoding: 'image/png' })).data.blob : null;
  const response = await agent.post({
    text: richText.text,
    facets: richText.facets,
    langs: ['en'],
    createdAt: new Date().toISOString(),
    ...(blob && image ? { embed: { $type: 'app.bsky.embed.images' as const, images: [{ image: blob, alt: image.alt, aspectRatio: { width: 1200, height: 630 } }] } } : {}),
  });

  return response.uri ?? null;
}
