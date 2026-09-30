const CHECKOUT_PATH = '/api/checkout';
const CHECKOUT_PLANS = new Set(['monthly', 'annual']);

export function firstSearchParam(value: string | string[] | undefined | null): string | null {
  const raw = Array.isArray(value) ? value[0] : value;

  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sanitizeRedirectPath(rawRedirectPath: string | null): string | null {
  if (!rawRedirectPath) {
    return null;
  }

  if (!rawRedirectPath.startsWith('/') || rawRedirectPath.startsWith('//')) {
    return null;
  }

  if (rawRedirectPath.includes('\\') || rawRedirectPath.includes('://') || rawRedirectPath.includes('\0')) {
    return null;
  }

  return rawRedirectPath;
}

function checkoutParam(value: string | null, pattern: RegExp) {
  if (!value || !pattern.test(value)) {
    return null;
  }

  return value;
}

/**
 * Keeps an internal post-sign-in path. A checkout URL that lost `plan` because
 * `?` was split into a second search param is put back together.
 */
export function continuationFromSearchParams(params: {
  redirectTo?: string | string[] | null;
  plan?: string | string[] | null;
  coupon?: string | string[] | null;
}): string | null {
  const raw = sanitizeRedirectPath(firstSearchParam(params.redirectTo ?? null));

  if (!raw) {
    return null;
  }

  const pathOnly = raw.split('?')[0] ?? raw;

  if (pathOnly !== CHECKOUT_PATH) {
    return raw;
  }

  const url = new URL(raw, 'http://local');
  const plan = checkoutParam(firstSearchParam(params.plan ?? null), /^(monthly|annual)$/);
  const coupon = checkoutParam(firstSearchParam(params.coupon ?? null), /^[A-Za-z0-9_-]{1,64}$/);

  if (!url.searchParams.get('plan') && plan && CHECKOUT_PLANS.has(plan)) {
    url.searchParams.set('plan', plan);
  }

  if (!url.searchParams.get('coupon') && coupon) {
    url.searchParams.set('coupon', coupon);
  }

  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

export function continuationFromUrl(search: string): string {
  const params = new URLSearchParams(search);

  return (
    continuationFromSearchParams({
      redirectTo: params.get('redirectTo'),
      plan: params.get('plan'),
      coupon: params.get('coupon'),
    }) ?? '/'
  );
}

export function isApiContinuation(path: string) {
  return path.startsWith('/api/');
}
