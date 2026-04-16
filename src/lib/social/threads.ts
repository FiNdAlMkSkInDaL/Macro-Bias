import 'server-only';

/**
 * Threads (Meta) publishing module.
 *
 * Requires two env vars:
 *   THREADS_ACCESS_TOKEN  – long-lived access token from Meta Graph API
 *   THREADS_USER_ID       – numeric Threads user ID
 *
 * Publishing is a two-step process:
 *   1. Create a media container (POST /{user_id}/threads)
 *   2. Publish the container  (POST /{user_id}/threads_publish)
 *
 * Docs: https://developers.facebook.com/docs/threads/posts
 */

const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

type ThreadsEnvName = 'THREADS_ACCESS_TOKEN' | 'THREADS_USER_ID';

function getOptionalServerEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getRequiredThreadsEnv(name: ThreadsEnvName) {
  const value = getOptionalServerEnv(name);

  if (!value) {
    throw new Error(`Missing required Threads environment variable: ${name}`);
  }

  return value;
}

export function isThreadsConfigured() {
  return Boolean(
    getOptionalServerEnv('THREADS_ACCESS_TOKEN') &&
      getOptionalServerEnv('THREADS_USER_ID'),
  );
}

export async function publishToThreads(text: string): Promise<string | null> {
  const accessToken = getRequiredThreadsEnv('THREADS_ACCESS_TOKEN');
  const userId = getRequiredThreadsEnv('THREADS_USER_ID');

  // Step 1: Create a media container
  const createUrl = `${THREADS_API_BASE}/${userId}/threads`;

  const createResponse = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'TEXT',
      text,
      access_token: accessToken,
    }),
  });

  if (!createResponse.ok) {
    const body = (await createResponse.text()).slice(0, 400);
    throw new Error(`Threads create container failed (${createResponse.status}): ${body}`);
  }

  const createResult = (await createResponse.json()) as { id?: string };
  const containerId = createResult.id;

  if (!containerId) {
    throw new Error('Threads API did not return a container ID.');
  }

  // Step 2: Publish the container
  const publishUrl = `${THREADS_API_BASE}/${userId}/threads_publish`;

  const publishResponse = await fetch(publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: accessToken,
    }),
  });

  if (!publishResponse.ok) {
    const body = (await publishResponse.text()).slice(0, 400);
    throw new Error(`Threads publish failed (${publishResponse.status}): ${body}`);
  }

  const publishResult = (await publishResponse.json()) as { id?: string };

  return publishResult.id ?? null;
}
