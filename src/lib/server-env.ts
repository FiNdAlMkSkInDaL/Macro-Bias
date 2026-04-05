export function getRequiredServerEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getAppUrl(fallbackOrigin?: string): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? fallbackOrigin ?? 'http://localhost:3000';
}