/**
 * Schedule draft social posts into the publishing queue.
 * 
 * Scheduling logic (3-4 posts per trading day, engagement-heavy):
 * - engagement: one EVERY trading day at 14:00 UTC (highest frequency)
 * - daily_intercept / crypto_intercept / contrarian: one every 2nd trading day at 13:15 UTC
 * - receipt: one every 3rd trading day at 16:00 UTC
 * - educational_fomo: one every 3rd trading day at 15:00 UTC
 * - email_signup: one every 5th trading day at 14:30 UTC
 * - referral: one every 7th trading day at 15:30 UTC
 * 
 * Starts from the next weekday after the last scheduled post.
 * Posts with their own link use that link. Posts without (engagement) post as-is.
 * 
 * Usage: npx tsx src/scripts/schedule-drafts.ts [drafts-file-name]
 *   default: x-queue-drafts.json
 *   example: npx tsx src/scripts/schedule-drafts.ts x-queue-drafts-v3.json
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const draftsFileName = process.argv[2] ?? "x-queue-drafts.json";
const DRAFTS_PATH = path.join(process.cwd(), "src", "content", "marketing", draftsFileName);
const SCHEDULED_PATH = path.join(process.cwd(), "src", "content", "marketing", "x-queue-scheduled.json");
const CANONICAL_LINK = "https://macro-bias.com/emails?utm_source=x&utm_campaign=scheduled";

type Draft = {
  id: string;
  category: string;
  priority?: string;
  copy: string;
  link?: string | null;
};

type ScheduledPost = {
  id: string;
  category: string;
  copy: string;
  link: string | null;
  scheduled_at: string;
  status: string;
  priority?: string;
};

function isWeekday(date: Date) {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function getNextWeekday(date: Date) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  while (!isWeekday(next)) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

function toISO(date: Date, hour: number, minute: number) {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hour,
    minute,
    0,
    0,
  ));
  return d.toISOString();
}

async function main() {
  console.log(`Reading drafts from: ${draftsFileName}`);
  const drafts: Draft[] = JSON.parse(await readFile(DRAFTS_PATH, "utf8"));
  const existing: ScheduledPost[] = JSON.parse(await readFile(SCHEDULED_PATH, "utf8"));

  // Deduplicate: skip drafts whose id is already in the scheduled queue
  const existingIds = new Set(existing.map((p) => p.id));

  // Group by category, supporting new categories
  const primaryPosts = drafts.filter(d => 
    (d.category === "daily_intercept" || d.category === "crypto_intercept") && !existingIds.has(d.id)
  );
  const receipts = drafts.filter(d => d.category === "receipt" && !existingIds.has(d.id));
  const educational = drafts.filter(d => d.category === "educational_fomo" && !existingIds.has(d.id));
  const emailSignups = drafts.filter(d => d.category === "email_signup" && !existingIds.has(d.id));
  const engagement = drafts.filter(d => d.category === "engagement" && !existingIds.has(d.id));
  const referral = drafts.filter(d => d.category === "referral" && !existingIds.has(d.id));

  const totalDrafts = primaryPosts.length + receipts.length + educational.length + emailSignups.length + engagement.length + referral.length;

  if (totalDrafts === 0) {
    console.log("No new drafts to schedule (all already in queue).");
    return;
  }

  const scheduled: ScheduledPost[] = [];

  // Start from the day after the last scheduled post, or next weekday
  const lastScheduledDate = existing
    .filter(p => p.status === "scheduled")
    .map(p => new Date(p.scheduled_at).getTime())
    .reduce((max, t) => Math.max(max, t), 0);

  let cursor: Date;
  if (lastScheduledDate > 0) {
    cursor = new Date(lastScheduledDate);
    cursor = getNextWeekday(cursor);
  } else {
    const today = new Date();
    cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
    if (!isWeekday(cursor)) {
      cursor = getNextWeekday(cursor);
    }
  }

  function getLink(draft: Draft): string | null {
    // Engagement posts (link: null) stay linkless
    if (draft.link === null || draft.link === undefined) return null;
    if (draft.link === "") return null;
    return draft.link || CANONICAL_LINK;
  }

  let diIdx = 0;
  let rcIdx = 0;
  let edIdx = 0;
  let esIdx = 0;
  let enIdx = 0;
  let rfIdx = 0;
  let dayCount = 0;

  while (diIdx < primaryPosts.length || rcIdx < receipts.length || edIdx < educational.length || esIdx < emailSignups.length || enIdx < engagement.length || rfIdx < referral.length) {
    if (!isWeekday(cursor)) {
      cursor = getNextWeekday(cursor);
    }

    // Primary post (daily_intercept or crypto_intercept): every 2nd trading day at 13:15 UTC
    if (diIdx < primaryPosts.length && dayCount % 2 === 0) {
      scheduled.push({
        id: primaryPosts[diIdx].id,
        category: primaryPosts[diIdx].category,
        copy: primaryPosts[diIdx].copy,
        link: getLink(primaryPosts[diIdx]),
        scheduled_at: toISO(cursor, 13, 15),
        status: "scheduled",
      });
      diIdx++;
    }

    // Receipt: every 3rd trading day at 16:00 UTC
    if (rcIdx < receipts.length && dayCount % 3 === 1) {
      scheduled.push({
        id: receipts[rcIdx].id,
        category: receipts[rcIdx].category,
        copy: receipts[rcIdx].copy,
        link: getLink(receipts[rcIdx]),
        scheduled_at: toISO(cursor, 16, 0),
        status: "scheduled",
      });
      rcIdx++;
    }

    // Educational: every 3rd trading day at 15:00 UTC
    if (edIdx < educational.length && dayCount % 3 === 2) {
      scheduled.push({
        id: educational[edIdx].id,
        category: educational[edIdx].category,
        copy: educational[edIdx].copy,
        link: getLink(educational[edIdx]),
        scheduled_at: toISO(cursor, 15, 0),
        status: "scheduled",
      });
      edIdx++;
    }

    // Email signup: every 5th trading day at 14:30 UTC
    if (esIdx < emailSignups.length && dayCount % 5 === 0) {
      scheduled.push({
        id: emailSignups[esIdx].id,
        category: emailSignups[esIdx].category,
        copy: emailSignups[esIdx].copy,
        link: getLink(emailSignups[esIdx]),
        scheduled_at: toISO(cursor, 14, 30),
        status: "scheduled",
      });
      esIdx++;
    }

    // Engagement: EVERY trading day at 14:00 UTC (highest frequency)
    if (enIdx < engagement.length) {
      scheduled.push({
        id: engagement[enIdx].id,
        category: engagement[enIdx].category,
        copy: engagement[enIdx].copy,
        link: getLink(engagement[enIdx]),
        scheduled_at: toISO(cursor, 14, 0),
        status: "scheduled",
      });
      enIdx++;
    }

    // Referral: every 7th trading day at 15:30 UTC
    if (rfIdx < referral.length && dayCount % 7 === 6) {
      scheduled.push({
        id: referral[rfIdx].id,
        category: referral[rfIdx].category,
        copy: referral[rfIdx].copy,
        link: getLink(referral[rfIdx]),
        scheduled_at: toISO(cursor, 15, 30),
        status: "scheduled",
      });
      rfIdx++;
    }

    dayCount++;
    cursor = getNextWeekday(cursor);
  }

  // Append to existing scheduled queue
  const combined = [...existing, ...scheduled];
  await writeFile(SCHEDULED_PATH, JSON.stringify(combined, null, 2) + "\n", "utf8");

  const firstDate = scheduled[0]?.scheduled_at?.slice(0, 10) ?? "N/A";
  const lastDate = scheduled[scheduled.length - 1]?.scheduled_at?.slice(0, 10) ?? "N/A";

  console.log(`Scheduled ${scheduled.length} new posts from ${totalDrafts} drafts (${firstDate} – ${lastDate})`);
  console.log(`  primary (intercepts): ${primaryPosts.length}`);
  console.log(`  receipt: ${receipts.length}`);
  console.log(`  educational_fomo: ${educational.length}`);
  console.log(`  email_signup: ${emailSignups.length}`);
  console.log(`  engagement: ${engagement.length}`);
  console.log(`  referral: ${referral.length}`);
  console.log(`Total scheduled queue: ${combined.length} posts`);
}

main();
