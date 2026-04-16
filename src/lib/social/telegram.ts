import 'server-only';

type TelegramEnvName = 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHANNEL_ID';

function getOptionalServerEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getRequiredTelegramEnv(name: TelegramEnvName) {
  const value = getOptionalServerEnv(name);

  if (!value) {
    throw new Error(`Missing required Telegram environment variable: ${name}`);
  }

  return value;
}

export function isTelegramConfigured() {
  return Boolean(getOptionalServerEnv('TELEGRAM_BOT_TOKEN') && getOptionalServerEnv('TELEGRAM_CHANNEL_ID'));
}

export async function publishToTelegram(text: string): Promise<number | null> {
  const token = getRequiredTelegramEnv('TELEGRAM_BOT_TOKEN');
  const chatId = getRequiredTelegramEnv('TELEGRAM_CHANNEL_ID');

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 400);
    throw new Error(`Telegram API responded with ${response.status}: ${body}`);
  }

  const result = (await response.json()) as { ok: boolean; result?: { message_id?: number } };

  return result.result?.message_id ?? null;
}
