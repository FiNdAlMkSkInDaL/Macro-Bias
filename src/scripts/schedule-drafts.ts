/**
 * One-time script to convert draft social posts into scheduled posts
 * and append them to x-queue-scheduled.json.
 * 
 * Scheduling logic:
 * - daily_intercept: one per trading day at 13:15 UTC
 * - receipt: one every 2-3 days at 16:00 UTC
 * - educational_fomo: one every 2-3 days at 15:00 UTC
 * - email_signup: one every 3 days at 14:30 UTC
 * 
 * Starts May 1, 2026 and fills through May.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DRAFTS_PATH = path.join(process.cwd(), "src", "content", "marketing", "x-queue-drafts.json");
const SCHEDULED_PATH = path.join(process.cwd(), "src", "content", "marketing", "x-queue-scheduled.json");
const CANONICAL_LINK = "https://www.macro-bias.com/emails";

type Draft = {
  id: string;
  category: string;
  priority: string;
  copy: string;
};

type ScheduledPost = Draft & {
  link: string;
  scheduled_at: string;
  status: string;
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
  const drafts: Draft[] = JSON.parse(await readFile(DRAFTS_PATH, "utf8"));
  const existing: ScheduledPost[] = JSON.parse(await readFile(SCHEDULED_PATH, "utf8"));

  const dailyIntercepts = drafts.filter(d => d.category === "daily_intercept");
  const receipts = drafts.filter(d => d.category === "receipt");
  const educational = drafts.filter(d => d.category === "educational_fomo");
  const emailSignups = drafts.filter(d => d.category === "email_signup");

  const scheduled: ScheduledPost[] = [];
  let cursor = new Date(Date.UTC(2026, 4, 1)); // May 1, 2026

  // Ensure we start on a weekday
  if (!isWeekday(cursor)) {
    cursor = getNextWeekday(new Date(Date.UTC(2026, 3, 30)));
  }

  let diIdx = 0;
  let rcIdx = 0;
  let edIdx = 0;
  let esIdx = 0;
  let dayCount = 0;

  // Schedule across ~22 trading days (full month of May)
  while (diIdx < dailyIntercepts.length || rcIdx < receipts.length || edIdx < educational.length || esIdx < emailSignups.length) {
    if (!isWeekday(cursor)) {
      cursor = getNextWeekday(cursor);
    }

    // Daily intercept: every trading day at 13:15 UTC
    if (diIdx < dailyIntercepts.length) {
      scheduled.push({
        ...dailyIntercepts[diIdx],
        id: `draft-${dailyIntercepts[diIdx].id}`,
        link: CANONICAL_LINK,
        scheduled_at: toISO(cursor, 13, 15),
        status: "scheduled",
      });
      diIdx++;
    }

    // Receipt: every 2nd trading day at 16:00 UTC
    if (rcIdx < receipts.length && dayCount % 2 === 1) {
      scheduled.push({
        ...receipts[rcIdx],
        id: `draft-${receipts[rcIdx].id}`,
        link: CANONICAL_LINK,
        scheduled_at: toISO(cursor, 16, 0),
        status: "scheduled",
      });
      rcIdx++;
    }

    // Educational: every 3rd trading day at 15:00 UTC
    if (edIdx < educational.length && dayCount % 3 === 0 && dayCount > 0) {
      scheduled.push({
        ...educational[edIdx],
        id: `draft-${educational[edIdx].id}`,
        link: CANONICAL_LINK,
        scheduled_at: toISO(cursor, 15, 0),
        status: "scheduled",
      });
      edIdx++;
    }

    // Email signup: every 4th trading day at 14:30 UTC
    if (esIdx < emailSignups.length && dayCount % 4 === 0) {
      scheduled.push({
        ...emailSignups[esIdx],
        id: `draft-${emailSignups[esIdx].id}`,
        link: CANONICAL_LINK,
        scheduled_at: toISO(cursor, 14, 30),
        status: "scheduled",
      });
      esIdx++;
    }

    dayCount++;
    cursor = getNextWeekday(cursor);
  }

  // Append to existing scheduled queue
  const combined = [...existing, ...scheduled];
  await writeFile(SCHEDULED_PATH, JSON.stringify(combined, null, 2) + "\n", "utf8");

  console.log(`Scheduled ${scheduled.length} new posts from drafts (May 1 – ~May 30 2026)`);
  console.log(`  daily_intercept: ${dailyIntercepts.length}`);
  console.log(`  receipt: ${receipts.length}`);
  console.log(`  educational_fomo: ${educational.length}`);
  console.log(`  email_signup: ${emailSignups.length}`);
  console.log(`Total scheduled queue: ${combined.length} posts`);
}

main();
