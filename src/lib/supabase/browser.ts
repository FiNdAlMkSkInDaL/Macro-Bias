import { createBrowserClient } from '@supabase/ssr';

const SUPABASE_PUBLIC_ENV = {
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
} as const;

const REQUIRED_PUBLIC_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

function getRequiredPublicEnv(
  name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
): string {
  const value = SUPABASE_PUBLIC_ENV[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getMissingSupabasePublicEnvVars() {
  return REQUIRED_PUBLIC_ENV_VARS.filter((name) => !SUPABASE_PUBLIC_ENV[name]);
}

export function getSupabaseBrowserClientConfigError() {
  const missingEnvVars = getMissingSupabasePublicEnvVars();

  if (missingEnvVars.length === 0) {
    return null;
  }

  return `Missing required environment variable${missingEnvVars.length > 1 ? 's' : ''}: ${missingEnvVars.join(', ')}`;
}

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    getRequiredPublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredPublicEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}