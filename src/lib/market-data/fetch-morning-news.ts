import "server-only";

import { getRequiredServerEnv } from "@/lib/server-env";

const FINNHUB_MARKET_NEWS_URL = "https://finnhub.io/api/v1/news";
const MORNING_NEWS_LIMIT = 10;

type FinnhubMarketNewsItem = {
  headline: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinnhubMarketNewsItem(value: unknown): value is FinnhubMarketNewsItem {
  return isRecord(value) && typeof value.headline === "string";
}

export async function fetchMorningNews(): Promise<string[]> {
  const requestUrl = new URL(FINNHUB_MARKET_NEWS_URL);
  requestUrl.searchParams.set("category", "general");
  requestUrl.searchParams.set("token", getRequiredServerEnv("FINNHUB_API_KEY"));

  const response = await fetch(requestUrl, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Finnhub market news request failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();

  if (!Array.isArray(payload)) {
    throw new Error("Finnhub market news response was not an array.");
  }

  const headlines: string[] = [];
  const seenHeadlines = new Set<string>();

  for (const item of payload) {
    if (!isFinnhubMarketNewsItem(item)) {
      continue;
    }

    const headline = item.headline.trim();

    if (!headline || seenHeadlines.has(headline)) {
      continue;
    }

    seenHeadlines.add(headline);
    headlines.push(headline);

    if (headlines.length === MORNING_NEWS_LIMIT) {
      break;
    }
  }

  return headlines;
}