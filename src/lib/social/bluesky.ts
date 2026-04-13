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
  const agent = new AtpAgent({ service: 'https://bsky.social' });

  await agent.login({
    identifier: getRequiredBlueskyEnv('BLUESKY_IDENTIFIER'),
    password: getRequiredBlueskyEnv('BLUESKY_APP_PASSWORD'),
  });

  return agent;
}

export async function publishToBluesky(content: string): Promise<string | null> {
  const agent = await createBlueskyAgent();

  const richText = new RichText({ text: content });
  await richText.detectFacets(agent);

  if (richText.graphemeLength > MAX_BLUESKY_GRAPHEME_LENGTH) {
    console.warn(
      `[bluesky] Post exceeds ${MAX_BLUESKY_GRAPHEME_LENGTH} graphemes (${richText.graphemeLength}). Truncating.`,
    );
  }

  const response = await agent.post({
    text: richText.text,
    facets: richText.facets,
    langs: ['en'],
    createdAt: new Date().toISOString(),
  });

  return response.uri ?? null;
}
