/* Exercises the actual recovery modules with isolated auth transport fixtures.
 * Real provider/session/mail round trips are verified separately during QA. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { NextRequest, NextResponse } = require('next/server');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const origin = 'https://macro-bias.example';
const checks = [];
let fixture;
let clockNow;
const testEnv = { SUPABASE_SERVICE_ROLE_KEY: 'isolated-test-signing-key', NEXT_PUBLIC_SUPABASE_URL: 'https://auth.fixture.example', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key' };

const transport = {
  createServerClient(_url, _key, options) {
    fixture.clients++;
    if (options.cookieOptions) assert.equal(options.cookieOptions.httpOnly, true);
    return { auth: {
      async getSession() { fixture.calls.push('session'); return { data: { session: fixture.session }, error: fixture.sessionError }; },
      async getUser(token) { fixture.calls.push(['verify-user', token]); return { data: { user: fixture.user }, error: fixture.userError }; },
      async verifyOtp(params) { fixture.calls.push(['otp', params]); if (fixture.otpError) return { data: { session: null }, error: fixture.otpError }; options.cookies.setAll([{ name: 'fixture-auth', value: 'opaque-fixture', options: { httpOnly: true } }]); return { data: { session: fixture.session }, error: null }; },
      async exchangeCodeForSession(code) { fixture.calls.push(['code', code]); return { data: { session: fixture.session }, error: fixture.codeError }; },
      async resetPasswordForEmail(email, value) { fixture.calls.push(['email', email, value]); options.cookies.setAll([{ name: 'fixture-verifier', value: 'opaque-verifier', options: { httpOnly: true } }]); return { error: fixture.emailError }; },
      async updateUser(value) { fixture.calls.push(['update', value]); if (!fixture.updateError) fixture.user = { ...fixture.user, updated_at: 'changed-after-password-update' }; return { error: fixture.updateError }; },
      async signOut(value) { fixture.calls.push(['signout', value]); options.cookies.setAll([{ name: 'fixture-auth', value: '', options: { maxAge: 0 } }]); return { error: null }; },
      async setSession() { return { data: { session: fixture.session }, error: null }; },
    } };
  },
};
const cache = new Map();
function load(relative) {
  const file = path.join(root, relative);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Buffer, URL, URLSearchParams, Request, Response, console, Date: class extends Date { static now() { return clockNow ?? Date.now(); } }, process: { env: testEnv }, require(name) {
    if (name === 'server-only') return {};
    if (name === 'node:crypto') return require(name);
    if (name === 'next/server') return { NextRequest, NextResponse };
    if (name === '@supabase/ssr') return transport;
    if (name === '@supabase/supabase-js') return { createClient: () => fixture.admin };
    if (name === 'resend') return { Resend: class { constructor() { this.emails = { send: async (input, options) => { fixture.deliveries.push({ input, options }); return { data: { id: 'fixture-message-id' }, error: fixture.deliveryError }; } }; } } };
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), `${name}.ts`)));
    throw new Error(`Unexpected import ${name}`);
  } }, { filename: file });
  cache.set(file, module.exports);
  return module.exports;
}
const grants = load('src/lib/auth/recovery-grant.ts');
const api = load('src/app/api/auth/password-reset/route.ts');
const callback = load('src/app/auth/recovery/route.ts');
const mail = load('src/lib/auth/recovery-email.ts');
const legacyCallback = load('src/app/auth/callback/route.ts');

function setup(overrides = {}) {
  const user = { id: 'fixture-user', updated_at: '2026-10-02T10:00:00Z' };
  fixture = { clients: 0, calls: [], deliveries: [], claims: new Map(), user, session: { access_token: 'fixture-access-token', refresh_token: 'fixture-refresh', user }, ...overrides };
  fixture.admin = { from(table) { assert.equal(table, 'marketing_event_log'); return { async insert(row) { if (fixture.databaseError) return { error: fixture.databaseError }; if (fixture.claims.has(row.id)) return { error: { code: '23505' } }; fixture.claims.set(row.id, row); return { error: null }; } }; }, auth: { admin: { async generateLink(input) { fixture.calls.push(['generate', input]); return { data: { properties: { hashed_token: 'fixture-recovery-token-hash', verification_type: 'recovery' } }, error: fixture.generateError }; } } } };
  return fixture;
}
function grant(extra = {}) { return grants.createRecoveryGrant({ userId: fixture.user.id, userUpdatedAt: fixture.user.updated_at, accessToken: fixture.session.access_token, origin, redirectTo: '/crypto/dashboard', ...extra }); }
function request(route, method = 'GET', payload, cookie, requestOrigin = origin) {
  return new NextRequest(`${origin}${route}`, { method, headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie: `${grants.RECOVERY_COOKIE}=${cookie}` } : {}) }, ...(payload !== undefined ? { body: typeof payload === 'string' ? payload : JSON.stringify(payload) } : {}) });
}
function jwt(method, timestamp = Math.floor(Date.now() / 1000)) { return `fixture.${Buffer.from(JSON.stringify({ amr: [{ method, timestamp }] })).toString('base64url')}.verified-by-fixture-auth-server`; }
async function check(name, fn) { await fn(); checks.push(name); }
const result = async (response) => ({ status: response.status, body: await response.json() });

(async () => {
  await check('Grant rejects tampering, expired grants, other origins and unsafe continuations', () => {
    setup(); const value = grant(); const parsed = grants.readRecoveryGrant(value, origin); assert.equal(parsed.redirectTo, '/crypto/dashboard');
    assert.equal(grants.readRecoveryGrant(`${value}x`, origin), null);
    assert.equal(grants.readRecoveryGrant(value, 'https://outside.example'), null);
    assert.equal(grants.readRecoveryGrant(value, origin, parsed.expiresAt), null);
    assert.equal(grants.readRecoveryGrant(grant({ redirectTo: '//outside.example' }), origin).redirectTo, '/dashboard');
  });
  await check('Ordinary session and recovery-looking URL flags never authorize reset', async () => {
    setup(); assert.equal((await result(await api.GET(request('/api/auth/password-reset?authFlow=recovery&type=recovery')))).body.canReset, false);
    assert.equal((await api.PUT(request('/api/auth/password-reset', 'PUT', { password: 'strong-test-password' }))).status, 401);
    assert.equal(fixture.calls.some((call) => Array.isArray(call) && call[0] === 'update'), false);
  });
  await check('Forged grant is rejected before any user/session query', async () => {
    setup(); await api.GET(request('/api/auth/password-reset', 'GET', undefined, 'forged.signature')); assert.equal(fixture.calls.length, 0);
  });
  await check('Verified authority requires exact user id, changed-state stamp and access token', async () => {
    for (const field of ['id', 'updated_at', 'access_token']) {
      setup(); const value = grant(); if (field === 'access_token') fixture.session.access_token = 'ordinary-new-session'; else fixture.user[field] = 'different';
      assert.equal((await result(await api.GET(request('/api/auth/password-reset', 'GET', undefined, value)))).body.canReset, false);
    }
    setup(); const value = grant(); fixture.userError = { message: 'invalid token internals' };
    assert.equal((await result(await api.GET(request('/api/auth/password-reset', 'GET', undefined, value)))).body.canReset, false);
  });
  await check('Server getUser verifies the exact token before authorized status/update', async () => {
    setup(); const value = grant(); const response = await result(await api.GET(request('/api/auth/password-reset', 'GET', undefined, value)));
    assert.equal(response.body.canReset, true); assert.equal(response.body.redirectTo, '/crypto/dashboard'); assert.equal(fixture.calls[1][1], 'fixture-access-token');
  });
  await check('Cross-origin mutations reject before auth or email transport', async () => {
    setup(); for (const method of ['POST', 'PUT']) assert.equal((await api[method](request('/api/auth/password-reset', method, { email: 'person@example.test', password: 'strong-password' }, grant(), 'https://outside.example'))).status, 403);
    assert.equal(fixture.clients, 0);
  });
  await check('Short passwords are rejected before provider mutation and preserve authority', async () => {
    setup(); const response = await api.PUT(request('/api/auth/password-reset', 'PUT', { password: 'short' }, grant())); assert.equal(response.status, 400); assert.equal(fixture.calls.some((call) => Array.isArray(call) && call[0] === 'update'), false);
  });
  await check('Successful update signs out locally, removes grant and makes copied grant unusable', async () => {
    setup(); const value = grant(); const response = await api.PUT(request('/api/auth/password-reset', 'PUT', { password: 'strong-password' }, value)); const body = await response.json();
    assert.equal(body.ok, true); assert.equal(body.redirectTo, '/crypto/dashboard'); assert.equal(fixture.calls.at(-1)[0], 'signout'); assert.equal(fixture.calls.at(-1)[1].scope, 'local');
    assert.equal(response.cookies.get(grants.RECOVERY_COOKIE).value, '');
    assert.equal((await api.PUT(request('/api/auth/password-reset', 'PUT', { password: 'another-password' }, value))).status, 401);
  });
  await check('Provider weak/same-password/rate failures use safe messages without internal errors', async () => {
    for (const [code, status, expected] of [['weak_password', 400, /stronger/], ['same_password', 400, /different/], ['over_request_rate_limit', 429, /wait/]]) {
      setup({ updateError: { code, message: 'PRIVATE AUTH INTERNALS' } }); const response = await result(await api.PUT(request('/api/auth/password-reset', 'PUT', { password: 'valid-long-password' }, grant()))); assert.equal(response.status, status); assert.match(response.body.error, expected); assert.doesNotMatch(response.body.error, /PRIVATE/);
    }
  });
  await check('Invalid/expired/missing/wrong-type recovery tokens redirect without token parameters', async () => {
    for (const suffix of ['', '?token_hash=short&type=recovery', '?token_hash=fixture-valid-token-hash&type=signup', '?token_hash=fixture-valid-token-hash&type=recovery']) {
      setup({ otpError: { message: 'PRIVATE EXPIRED TOKEN' } }); const response = await callback.GET(request(`/auth/recovery${suffix}`)); assert.equal(response.status, 303); const location = response.headers.get('location'); assert.match(location, /reset-password\?error=invalid-link/); assert.doesNotMatch(location, /token_hash|PRIVATE|fixture-valid/); assert.equal(response.cookies.get(grants.RECOVERY_COOKIE).value, ''); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    }
  });
  await check('Actual recovery token verification creates HttpOnly authority and keeps annual/coupon return', async () => {
    setup(); const destination = '/api/checkout?plan=annual&coupon=SAFE_20&redirectTo=%2Fbriefings%2F2026-10-01';
    const response = await callback.GET(request(`/auth/recovery?token_hash=fixture-valid-token-hash&type=recovery&redirectTo=${encodeURIComponent(destination)}`));
    assert.equal(response.status, 303); assert.equal(response.headers.get('location'), `${origin}/reset-password#`); assert.equal(fixture.calls[0][0], 'otp'); assert.equal(fixture.calls[0][1].type, 'recovery');
    const cookie = response.cookies.get(grants.RECOVERY_COOKIE); assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true); assert.equal(cookie.sameSite, 'lax'); assert.equal(cookie.maxAge, 600); assert.equal(grants.readRecoveryGrant(cookie.value, origin).redirectTo, destination);
  });
  await check('PKCE accepts only fresh provider-verified recovery AMR, rejecting ordinary sign-in codes', async () => {
    for (const [method, age, accepted] of [['recovery', 0, true], ['password', 0, false], ['email/signup', 0, false], ['recovery', -601, false]]) {
      setup(); fixture.session.access_token = jwt(method, Math.floor(Date.now() / 1000) + age);
      const response = await callback.GET(request('/auth/recovery?code=fixture-valid-pkce-code&type=recovery'));
      const cookie = response.cookies.get(grants.RECOVERY_COOKIE); assert.equal(Boolean(cookie.value), accepted); assert.ok(fixture.calls.some((call) => Array.isArray(call) && call[0] === 'verify-user'));
    }
  });
  await check('Email request keeps generic success and sanitized same-site recovery redirect/PKCE cookie', async () => {
    setup(); const response = await api.POST(request('/api/auth/password-reset', 'POST', { email: 'person@example.test', redirectTo: '//outside.example' })); assert.equal((await response.json()).ok, true); const call = fixture.calls.find((value) => Array.isArray(value) && value[0] === 'email'); const url = new URL(call[2].redirectTo); assert.equal(url.origin, origin); assert.equal(url.pathname, '/auth/recovery'); assert.equal(url.searchParams.get('redirectTo'), '/dashboard'); assert.equal(response.cookies.get('fixture-verifier').httpOnly, true);
  });
  await check('Email validation/payload/rate/network failures are controlled and disclose no account state', async () => {
    setup(); assert.equal((await api.POST(request('/api/auth/password-reset', 'POST', { email: 'invalid' }))).status, 400); assert.equal(fixture.clients, 0);
    setup(); assert.equal((await api.POST(request('/api/auth/password-reset', 'POST', { email: `${'x'.repeat(65)}@example.test` }))).status, 400); assert.equal(fixture.clients, 0);
    setup({ emailError: { code: 'over_email_send_rate_limit', message: 'PRIVATE ACCOUNT STATE' } }); const response = await result(await api.POST(request('/api/auth/password-reset', 'POST', { email: 'person@example.test' }))); assert.equal(response.status, 429); assert.doesNotMatch(response.body.error, /PRIVATE/);
  });
  await check('Empty optional grant secret safely falls back; weak explicit secret is refused', () => {
    setup(); testEnv.AUTH_RECOVERY_SECRET = ''; const value = grant(); assert.ok(grants.readRecoveryGrant(value, origin)); testEnv.AUTH_RECOVERY_SECRET = 'weak'; assert.throws(() => grant()); delete testEnv.AUTH_RECOVERY_SECRET;
  });
  await check('Recovery cookie maxAge is capped despite SSR long-lived defaults', async () => {
    setup(); const response = await callback.GET(request('/auth/recovery?token_hash=fixture-valid-token-hash&type=recovery'));
    assert.equal(response.cookies.get('fixture-auth').maxAge, 3600); assert.equal(response.cookies.get('fixture-auth').httpOnly, true);
  });
  await check('Legacy callback errors are private, safe and keep the continuation', async () => {
    setup({ codeError: { message: 'PRIVATE AUTH TOKEN' } }); const response = await legacyCallback.GET(request('/auth/callback?code=expired-code&redirectTo=%2Fcrypto%2Fdashboard'));
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.match(response.headers.get('cache-control'), /no-store/); const url = new URL(response.headers.get('location')); assert.equal(url.searchParams.get('redirectTo'), '/crypto/dashboard'); assert.doesNotMatch(url.searchParams.get('authError'), /PRIVATE/);
  });
  await check('Trusted delivery origin permits only owned domains, exact deployment hosts and local non-Vercel QA', () => {
    setup(); assert.equal(mail.trustedRecoveryOrigin(request('/forgot-password')), null);
    testEnv.VERCEL_URL = 'exact-preview.vercel.app'; assert.equal(mail.trustedRecoveryOrigin(new NextRequest('https://exact-preview.vercel.app/')), 'https://exact-preview.vercel.app'); assert.equal(mail.trustedRecoveryOrigin(new NextRequest('https://lookalike.vercel.app/')), null);
    assert.equal(mail.trustedRecoveryOrigin(new NextRequest('https://macro-bias.com/')), 'https://macro-bias.com'); assert.equal(mail.trustedRecoveryOrigin(new NextRequest('http://localhost:3003/')), 'http://localhost:3003');
    testEnv.VERCEL = '1'; assert.equal(mail.trustedRecoveryOrigin(new NextRequest('http://localhost:3003/')), null); delete testEnv.VERCEL; delete testEnv.VERCEL_URL;
  });
  await check('Dedicated email uses only requested recipient, owned token callback and no marketing override', async () => {
    setup(); testEnv.RESEND_API_KEY = 'fixture-key'; testEnv.SHADOW_RUN_EMAIL = 'unrelated@example.test'; const destination = '/api/checkout?plan=annual&coupon=SAFE_20';
    const response = await mail.sendRecoveryEmail(new NextRequest('https://macro-bias.com/api/auth/password-reset'), 'person@example.test', destination);
    assert.equal(response.ok, true); assert.equal(fixture.deliveries.length, 1); const delivery = fixture.deliveries[0]; assert.equal(delivery.input.to.join(), 'person@example.test'); assert.match(delivery.input.text, /https:\/\/macro-bias.com\/auth\/recovery\?/); assert.match(delivery.input.html, /&amp;token_hash=/); assert.match(delivery.input.text, /type=recovery/);
    assert.equal(fixture.claims.size, 3); for (const row of fixture.claims.values()) { assert.equal(row.event_name, mail.RECOVERY_LIMIT_EVENT); assert.equal(row.metadata.recovery_identity, mail.recoveryRateLimitIdentity('person@example.test')); assert.doesNotMatch(JSON.stringify(row), /person@example|token_hash|fixture-recovery-token/); }
    delete testEnv.SHADOW_RUN_EMAIL;
  });
  await check('Persistent atomic claims prevent parallel duplicate deliveries', async () => {
    setup(); const req = new NextRequest('https://macro-bias.com/api/auth/password-reset'); const responses = await Promise.all([mail.sendRecoveryEmail(req, 'person@example.test', '/dashboard'), mail.sendRecoveryEmail(req, 'person@example.test', '/dashboard')]);
    assert.equal(responses.filter((r) => r.ok).length, 1); assert.equal(responses.find((r) => !r.ok).status, 429); assert.equal(fixture.deliveries.length, 1);
  });
  await check('Hourly email quotas apply across time buckets and DB failures fail closed', async () => {
    setup(); const req = new NextRequest('https://macro-bias.com/api/auth/password-reset'); const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    for (let minute = 0; minute < 6; minute++) { clockNow = start + minute * 60_000; const response = await mail.sendRecoveryEmail(req, 'person@example.test', '/dashboard'); assert.equal(response.ok, minute < 5); if (minute === 5) assert.equal(response.status, 429); }
    clockNow = undefined; setup({ databaseError: { code: '42501', message: 'PRIVATE DB ERROR' } }); const response = await mail.sendRecoveryEmail(req, 'person@example.test', '/dashboard'); assert.equal(response.status, 503); assert.equal(fixture.deliveries.length, 0); assert.equal(fixture.calls.length, 0);
  });
  await check('Unknown accounts return generic acceptance without identity creation/mail; provider failures are controlled', async () => {
    const req = new NextRequest('https://macro-bias.com/api/auth/password-reset'); setup({ generateError: { code: 'user_not_found', status: 404 } }); const unknown = await mail.sendRecoveryEmail(req, 'missing@example.test', '/dashboard'); assert.equal(unknown.ok, true); assert.equal(fixture.deliveries.length, 0);
    setup({ deliveryError: { name: 'validation_error', message: 'PRIVATE PROVIDER DETAILS' } }); const failed = await mail.sendRecoveryEmail(req, 'person@example.test', '/dashboard'); assert.equal(failed.status, 503); assert.doesNotMatch(failed.error, /PRIVATE/);
    delete testEnv.RESEND_API_KEY;
  });
  await check('Retryable Supabase transport failures preserve valid recovery authority for retry', async () => {
    for (const status of [503, 429]) {
      setup(); const value = grant(); fixture.userError = { name: 'AuthRetryableFetchError', status, message: 'PRIVATE NETWORK DETAILS' };
      const response = await api.GET(request('/api/auth/password-reset', 'GET', undefined, value)); assert.equal(response.status, status); assert.equal(response.cookies.get(grants.RECOVERY_COOKIE), undefined);
      const update = await api.PUT(request('/api/auth/password-reset', 'PUT', { password: 'strong-password' }, value)); assert.equal(update.status, status); assert.equal(update.cookies.get(grants.RECOVERY_COOKIE), undefined); assert.equal(fixture.calls.some((call) => Array.isArray(call) && call[0] === 'update'), false);
    }
  });
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
