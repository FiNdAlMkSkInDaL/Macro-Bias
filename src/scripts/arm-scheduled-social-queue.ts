import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadEnvConfig } from '@next/env';

import { createSupabaseAdminClient } from '../lib/supabase/admin';

const CANONICAL_EMAIL_LINK = 'https://macro-bias.com/emails?utm_source=x&utm_campaign=scheduled';
const QUEUE_FILE_PATH = path.join(process.cwd(), 'src', 'content', 'marketing', 'x-queue-scheduled.json');

type ScheduledQueueArtifact = {
  category: string;
  copy: string;
  id: string;
  link: string | null;
  priority?: string;
  scheduled_at: string;
  status: string;
};

type ExistingScheduledPostRow = {
  post_body: string | null;
  scheduled_at: string | null;
};

function getDeduplicationKey(postBody: string, scheduledAt: string) {
  return `${new Date(scheduledAt).toISOString()}::${postBody}`;
}

function validateScheduledQueueArtifact(value: unknown): value is ScheduledQueueArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const post = value as Partial<ScheduledQueueArtifact>;

  return (
    typeof post.id === 'string' &&
    typeof post.category === 'string' &&
    typeof post.copy === 'string' &&
    (typeof post.link === 'string' || post.link === null) &&
    typeof post.scheduled_at === 'string' &&
    typeof post.status === 'string'
  );
}

async function loadScheduledQueueArtifacts() {
  const rawFile = await readFile(QUEUE_FILE_PATH, 'utf8');
  const parsedFile = JSON.parse(rawFile) as unknown;

  if (!Array.isArray(parsedFile)) {
    throw new Error('x-queue-scheduled.json must contain an array of scheduled posts.');
  }

  const artifacts = parsedFile.filter(validateScheduledQueueArtifact);

  if (artifacts.length !== parsedFile.length) {
    throw new Error('x-queue-scheduled.json contains one or more invalid scheduled post records.');
  }

  for (const artifact of artifacts) {
    if (!artifact.copy.trim()) {
      throw new Error(`Scheduled post ${artifact.id} is empty.`);
    }

    if (artifact.link && !artifact.link.startsWith('https://macro-bias.com/')) {
      throw new Error(`Scheduled post ${artifact.id} link must use the macro-bias.com domain.`);
    }

    if (Number.isNaN(Date.parse(artifact.scheduled_at))) {
      throw new Error(`Scheduled post ${artifact.id} has an invalid scheduled_at timestamp.`);
    }
  }

  const scheduledArtifacts = artifacts.filter((artifact) => artifact.status === 'scheduled');
  const skippedCount = artifacts.length - scheduledArtifacts.length;

  if (skippedCount > 0) {
    console.log(`Skipping ${skippedCount} non-scheduled entries (status != "scheduled").`);
  }

  return scheduledArtifacts;
}

async function loadExistingScheduledPosts() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('post_body, scheduled_at')
    .order('scheduled_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load existing scheduled posts: ${error.message}`);
  }

  return ((data as ExistingScheduledPostRow[] | null) ?? []).reduce((keys, row) => {
    if (typeof row.post_body === 'string' && typeof row.scheduled_at === 'string') {
      keys.add(getDeduplicationKey(row.post_body, row.scheduled_at));
    }

    return keys;
  }, new Set<string>());
}

async function main() {
  loadEnvConfig(process.cwd());

  const artifacts = await loadScheduledQueueArtifacts();
  const existingKeys = await loadExistingScheduledPosts();
  const rowsToInsert = artifacts
    .filter((artifact) => !existingKeys.has(getDeduplicationKey(artifact.copy.trim(), artifact.scheduled_at)))
    .map((artifact) => ({
      id: randomUUID(),
      link: artifact.link || null,
      post_body: artifact.copy.trim(),
      scheduled_at: artifact.scheduled_at,
      status: 'scheduled',
    }));

  if (rowsToInsert.length > 0) {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.from('scheduled_posts').insert(rowsToInsert).select('id');

    if (error) {
      throw new Error(`Failed to insert scheduled social posts: ${error.message}`);
    }

    const insertedRows = (data as Array<{ id: string }> | null) ?? [];

    console.log(
      JSON.stringify(
        {
          insertedCount: insertedRows.length,
          queuedCount: artifacts.length,
          skippedCount: artifacts.length - insertedRows.length,
        },
        null,
        2,
      ),
    );

    return;
  }

  console.log(
    JSON.stringify(
      {
        insertedCount: 0,
        queuedCount: artifacts.length,
        skippedCount: artifacts.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error('Scheduled social queue arm failed.');
  console.error(error);
  process.exit(1);
});