/**
 * Threads OAuth token exchange helper.
 *
 * Usage:
 *   Step 1: Run without args to get the authorization URL:
 *     npx tsx scripts/threads-auth.ts
 *
 *   Step 2: Visit the URL, authorize, copy the `code` param from the redirect URL.
 *
 *   Step 3: Run with the code to exchange for a long-lived token:
 *     npx tsx scripts/threads-auth.ts <CODE> <REDIRECT_URI>
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const APP_ID = process.env.THREADS_APP_ID ?? "";
const APP_SECRET = process.env.THREADS_APP_SECRET ?? "";

if (!APP_ID || !APP_SECRET) {
  console.error("Missing THREADS_APP_ID or THREADS_APP_SECRET in .env.local");
  process.exit(1);
}

const code = process.argv[2];
const redirectUri = process.argv[3] ?? "https://www.macro-bias.com/";

if (!code) {
  // Step 1: Print the authorization URL
  const scopes = "threads_basic,threads_content_publish";
  const authUrl =
    `https://threads.net/oauth/authorize` +
    `?client_id=${APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&response_type=code`;

  console.log("\n=== THREADS OAUTH SETUP ===\n");
  console.log("1. Make sure this redirect URI is added in your Meta app settings:");
  console.log(`   ${redirectUri}\n`);
  console.log("2. Visit this URL and authorize the app:\n");
  console.log(authUrl);
  console.log("\n3. After authorizing, you'll be redirected to something like:");
  console.log(`   ${redirectUri}?code=ABC123#_`);
  console.log("\n4. Copy the 'code' value (everything between ?code= and #_)");
  console.log("\n5. Run this script again with the code:");
  console.log(`   npx tsx scripts/threads-auth.ts YOUR_CODE_HERE ${redirectUri}\n`);
  process.exit(0);
}

async function exchangeForShortLivedToken() {
  console.log("\nExchanging authorization code for short-lived token...");

  const response = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: APP_ID,
      client_secret: APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Failed to get short-lived token (${response.status}):`, body);
    process.exit(1);
  }

  const result = (await response.json()) as { access_token: string; user_id: number };
  console.log("  Short-lived token obtained.");
  console.log(`  User ID: ${result.user_id}`);
  return result;
}

async function exchangeForLongLivedToken(shortLivedToken: string) {
  console.log("Exchanging for long-lived token (60 days)...");

  const url =
    `https://graph.threads.net/access_token` +
    `?grant_type=th_exchange_token` +
    `&client_secret=${APP_SECRET}` +
    `&access_token=${shortLivedToken}`;

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text();
    console.error(`Failed to get long-lived token (${response.status}):`, body);
    console.log("\nFalling back to short-lived token (valid ~1 hour).");
    return shortLivedToken;
  }

  const result = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };

  const expiresInDays = Math.round(result.expires_in / 86400);
  console.log(`  Long-lived token obtained (expires in ~${expiresInDays} days).`);
  return result.access_token;
}

async function main() {
  const { access_token: shortToken, user_id } = await exchangeForShortLivedToken();
  const longToken = await exchangeForLongLivedToken(shortToken);

  console.log("\n=== ADD THESE TO .env.local AND VERCEL ===\n");
  console.log(`THREADS_ACCESS_TOKEN=${longToken}`);
  console.log(`THREADS_USER_ID=${user_id}`);
  console.log("\n=== DONE ===\n");
  console.log("The long-lived token is valid for ~60 days.");
  console.log("You'll need to refresh it before it expires.");
}

main();
