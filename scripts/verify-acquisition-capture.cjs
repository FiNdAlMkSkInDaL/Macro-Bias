/** Exercise actual capture source with isolated storage/transport/database. No network or credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const NOW = Date.parse('2026-10-04T20:00:00Z');
const nav = '11111111-1111-4111-8111-111111111111';

function harness(options = {}) {
  let now = NOW;
  const cache = new Map(), cookies = new Map(), storage = new Map(), transmitted = [], rows = new Map();
  const effects = { databaseWrites: 0, storedRows: 0 };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const document = { referrer: options.referrer ?? 'https://www.google.com/search?q=private+email@example.com',
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
    set cookie(value) { const [pair] = value.split(';'); const index = pair.indexOf('=');
      if (/Max-Age=0(?:;|$)/.test(value)) cookies.delete(pair.slice(0, index));
      else cookies.set(pair.slice(0, index), pair.slice(index + 1)); },
  };
  const storageApi = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { if (options.blockStorage) throw new Error('Storage blocked'); storage.set(key, value); },
    removeItem: key => storage.delete(key) };
  const browser = { location: new URL(options.url ?? 'https://www.macro-bias.com/today?utm_source=X&utm_medium=Social&utm_campaign=October&utm_content=video'),
    localStorage: storageApi, sessionStorage: storageApi, dispatchEvent() {} };
  const navigator = { userAgent: 'Mozilla/5.0 Chrome/131', doNotTrack: '0', globalPrivacyControl: false,
    sendBeacon: (_url, blob) => { if (options.beaconFails) return false; transmitted.push(blob); return true; } };
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const context = vm.createContext({ module, exports: module.exports, Date: Clock, URL, URLSearchParams,
      Uint8Array, TextDecoder, Blob, Request, Response, Event, crypto: webcrypto, window: browser, document, navigator,
      fetch: async (_url, request) => { transmitted.push(new Blob([request.body])); return new Response('{}'); },
      require(specifier) {
        if (specifier === 'next/server') return { NextResponse: { json: (body, options) => Response.json(body, options) } };
        if (specifier === '@/lib/analytics/server') return { logMarketingEvent: async event => {
          effects.databaseWrites++; if (!rows.has(event.id)) rows.set(event.id, structuredClone(event)); effects.storedRows = rows.size;
        } };
        if (specifier.startsWith('@/')) return load(path.join(root, 'src', specifier.slice(2)) + '.ts');
        if (specifier.startsWith('.')) return load(path.resolve(path.dirname(file), specifier) + '.ts');
        throw new Error(`Unexpected module ${specifier}`);
      },
    });
    new vm.Script(compiled, { filename: file }).runInContext(context); return module.exports;
  }
  const pure = load(path.join(root, 'src/lib/analytics/attribution.ts'));
  const client = load(path.join(root, 'src/lib/analytics/client.ts'));
  const capture = load(path.join(root, 'src/lib/analytics/public-capture.ts'));
  const route = load(path.join(root, 'src/app/api/analytics/track/route.ts'));
  return { pure, client, capture, route, effects, storage, cookies, document, browser, navigator, rows,
    advance: value => { now += value; }, location: url => { browser.location = new URL(url); },
    messages: async () => Promise.all(transmitted.map(async blob => JSON.parse(await blob.text()))),
    request: (body, headers = {}, url = 'https://www.macro-bias.com/api/analytics/track') => new Request(url, { method: 'POST', headers: {
      origin: new URL(url).origin, 'content-type': 'application/json', 'user-agent': navigator.userAgent,
      cookie: document.cookie, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
  };
}

let count = 0;
async function check(name, run) { await run(); count++; console.log(`PASS ${name}`); }

(async () => {
  await check('pending consent sends anonymous source-only page view, no persistent identity', async () => {
    const h = harness(); h.client.trackClientEvent({ eventName: 'page_view' });
    const [event] = await h.messages();
    assert.equal(event.anonymousId, null); assert.equal(event.sessionId, null); assert.equal(event.metadata.tracking_mode, 'aggregate');
    assert.equal(event.metadata.aggregate_touch.source, 'x'); assert.equal(event.metadata.aggregate_touch.medium, 'social');
    assert.equal(h.storage.size, 0); assert.equal(h.cookies.size, 0);
    assert(!JSON.stringify(event).includes('private+email')); assert.equal(event.pagePath, '/today');
  });
  await check('platform sources normalize consistently and invalid private UTM source is unknown', async () => {
    const h = harness();
    assert.equal(h.pure.deriveAcquisitionTouch({ url: 'https://www.macro-bias.com/today?utm_source=Twitter&utm_medium=social' }).source, 'x');
    assert.equal(h.pure.deriveAcquisitionTouch({ url: 'https://www.macro-bias.com/today', referrer: 'https://t.co/short' }).source, 'x');
    assert.equal(h.pure.deriveAcquisitionTouch({ url: 'https://www.macro-bias.com/today', referrer: 'https://www.google.co.uk/search?q=private' }).source, 'google');
    const invalid = h.pure.deriveAcquisitionTouch({ url: 'https://www.macro-bias.com/today?utm_source=private@example.com' });
    assert.equal(invalid.source, 'unknown'); assert(!JSON.stringify(invalid).includes('private@example.com'));
  });
  await check('only known search suffixes infer organic medium; Google lookalike referrers remain literal referrals', async () => {
    const h = harness(), url = 'https://www.macro-bias.com/today';
    for (const referrer of ['https://www.google.com/search?q=private', 'https://www.google.co.uk/search?q=private']) {
      const touch = h.pure.deriveAcquisitionTouch({ url, referrer });
      assert.equal(touch.source, 'google'); assert.equal(touch.medium, 'organic'); assert(!JSON.stringify(touch).includes('private'));
    }
    for (const domain of ['search.yahoo.com', 'search.yahoo.co.jp', 'search.yahoo.co.uk']) {
      const touch = h.pure.deriveAcquisitionTouch({ url, referrer: `https://${domain}/search?q=private` });
      assert.equal(touch.source, 'yahoo'); assert.equal(touch.medium, 'organic'); assert.equal(touch.referrerDomain, domain);
    }
    const lookalike = h.pure.deriveAcquisitionTouch({ url, referrer: 'https://google.attacker.com/search?q=private' });
    assert.equal(lookalike.source, 'google.attacker.com'); assert.equal(lookalike.medium, 'referral');
    assert.equal(lookalike.referrerDomain, 'google.attacker.com'); assert(!JSON.stringify(lookalike).includes('private'));
  });
  await check('exact Reddit and Gmail Android referrers preserve package-only attribution and explicit medium precedence', async () => {
    const h = harness(), url = 'https://www.macro-bias.com/today';
    for (const [packageName, source, medium] of [['com.reddit.frontpage', 'reddit', 'social'], ['com.google.android.gm', 'gmail', 'email']]) {
      const referrer = `android-app://${packageName}/private/path?email=private@example.com&token=SECRET`;
      const touch = h.pure.deriveAcquisitionTouch({ url, referrer });
      assert.equal(touch.source, source); assert.equal(touch.medium, medium); assert.equal(touch.referrerDomain, packageName);
      assert(!JSON.stringify(touch).includes('SECRET')); assert(!JSON.stringify(touch).includes('private'));
      assert.equal(h.pure.deriveAcquisitionTouch({ url: `${url}?utm_medium=paid_social`, referrer }).medium, 'paid_social');
    }
  });
  await check('unknown, spoofed or credential-bearing Android and non-HTTP referrers are rejected', async () => {
    const h = harness(), url = 'https://www.macro-bias.com/today';
    for (const referrer of ['android-app://com.unknown.app/private', 'android-app://com.reddit.frontpage.attacker/private',
      'android-app://private:SECRET@com.reddit.frontpage/private', 'android-app://com.reddit.frontpage:123/private',
      'ftp://reddit.com/private', 'javascript:alert(1)', 'mailto:private@example.com', 'data:text/plain,SECRET']) {
      assert.equal(h.pure.normalizeReferrerDomain(referrer), null);
      const touch = h.pure.deriveAcquisitionTouch({ url, referrer });
      assert.equal(touch.referrerDomain, null); assert.equal(touch.source, 'direct'); assert.equal(touch.medium, 'none');
      assert(!JSON.stringify(touch).includes('SECRET')); assert(!JSON.stringify(touch).includes('private'));
    }
  });
  await check('explicit consent identifies one navigation without duplicating page views', async () => {
    const h = harness(); h.client.trackClientEvent({ eventName: 'page_view' }); h.client.setAnalyticsConsent('granted'); h.client.setAnalyticsConsent('granted');
    const events = await h.messages(), page = events[0], markers = events.slice(1);
    assert.equal(events.filter(event => event.eventName === 'page_view').length, 1);
    assert.equal(markers[0].eventName, 'visitor_identified'); assert.equal(markers[0].eventId, markers[1].eventId);
    assert.equal(markers[0].metadata.navigation_id, page.metadata.navigation_id); assert.notEqual(markers[0].eventId, page.eventId);
    assert.equal(h.pure.parseAcquisitionCookie(h.document.cookie).visitorId, markers[0].anonymousId);
  });
  await check('later consent retains first landing labels from volatile memory without preconsent linkage', async () => {
    const h = harness(); h.client.trackClientEvent({ eventName: 'page_view' });
    h.advance(1000); h.location('https://www.macro-bias.com/crypto'); h.client.trackClientEvent({ eventName: 'page_view' });
    assert.equal(h.storage.size, 0); assert.equal(h.cookies.size, 0);
    h.client.setAnalyticsConsent('granted'); const attr = h.client.getAcquisitionAttribution();
    assert.equal(attr.firstTouch.source, 'x'); assert.equal(attr.firstTouch.landingPath, '/today'); assert.equal(attr.latestTouch.source, 'x');
    const events = await h.messages(); assert.equal(events.filter(event => event.eventName === 'page_view').length, 2);
    assert.equal(events.at(-1).metadata.navigation_id, events[1].metadata.navigation_id);
  });
  await check('first discovery persists while latest campaign changes; direct/auth/Stripe never erase it', async () => {
    const h = harness(); h.client.setAnalyticsConsent('granted'); const first = h.client.getAcquisitionAttribution();
    h.advance(1000); h.location('https://www.macro-bias.com/crypto?utm_source=reddit&utm_medium=social&utm_campaign=btc');
    const latest = h.client.getAcquisitionAttribution(); assert.equal(latest.firstTouch.source, 'x'); assert.equal(latest.latestTouch.source, 'reddit');
    for (const url of ['https://www.macro-bias.com/login?code=SECRET', 'https://www.macro-bias.com/auth/callback?code=SECRET',
      'https://www.macro-bias.com/reset-password?token_hash=SECRET', 'https://www.macro-bias.com/analytics?utm_source=internal', 'https://www.macro-bias.com/crypto']) {
      h.advance(1000); h.location(url); assert.equal(h.client.getAcquisitionAttribution().latestTouch.source, 'reddit');
      h.client.trackClientEvent({ eventName: 'page_view' });
    }
    assert.equal(h.pure.deriveAcquisitionTouch({ url: 'https://www.macro-bias.com/today', referrer: 'https://checkout.stripe.com/c/pay/cs_SECRET' }).source, 'direct');
    assert(!JSON.stringify(await h.messages()).includes('SECRET')); assert.equal(first.visitorId, latest.visitorId);
  });
  await check('activity session expires at 30 minutes while visitor remains stable', async () => {
    const h = harness(); h.client.setAnalyticsConsent('granted'); const first = structuredClone(h.client.getAcquisitionAttribution());
    h.advance(29 * 60_000); assert.equal(h.client.getSessionId(), first.sessionId);
    h.advance(30 * 60_000); assert.notEqual(h.client.getSessionId(), first.sessionId); assert.equal(h.client.getAnonymousId(), first.visitorId);
  });
  await check('withdrawal clears linked records and cross-tab denied cookie takes precedence', async () => {
    const h = harness(); h.client.setAnalyticsConsent('granted'); assert(h.client.getAnonymousId());
    h.cookies.set('mb_analytics_consent', 'denied'); assert.equal(h.client.getAnonymousId(), null);
    assert.equal(h.storage.size, 0); assert(!h.cookies.has('mb_acquisition_v2'));
    h.client.trackClientEvent({ eventName: 'nav_link_click' }); assert.equal((await h.messages()).length, 1);
  });
  await check('DNT and GPC disable linkage despite prior consent', async () => {
    for (const signal of ['dnt', 'gpc']) {
      const h = harness(); h.client.setAnalyticsConsent('granted'); const cookie = h.document.cookie;
      if (signal === 'dnt') h.navigator.doNotTrack = '1'; else h.navigator.globalPrivacyControl = true;
      assert.equal(h.client.getAcquisitionAttribution(), null); assert.equal(h.storage.size, 0);
      assert.equal(h.pure.parseAcquisitionCookie(cookie, { [signal]: '1' }), null);
    }
  });
  await check('90-day identity expires and malformed/overlong cookies are rejected', async () => {
    const h = harness(); h.client.setAnalyticsConsent('granted'); const before = h.client.getAnonymousId(), cookie = h.document.cookie;
    h.advance(h.pure.ATTRIBUTION_MAX_AGE_MS + 1); assert.equal(h.pure.parseAcquisitionCookie(cookie, {}, NOW + h.pure.ATTRIBUTION_MAX_AGE_MS + 1), null);
    h.client.getAcquisitionAttribution(); const after = h.client.getAnonymousId(); assert(h.pure.UUID_PATTERN.test(after)); assert.notEqual(after, before);
    assert.equal(h.pure.parseAcquisitionCookie('mb_analytics_consent=granted; mb_acquisition_v2=%QQ'), null);
    assert.equal(h.pure.parseAcquisitionCookie(`mb_analytics_consent=granted; mb_acquisition_v2=${'x'.repeat(3100)}`), null);
  });
  await check('legacy timestamp visitor IDs migrate to valid UUIDs; blocked storage never breaks product', async () => {
    const h = harness(); h.cookies.set('mb_analytics_consent', 'granted'); h.storage.set('macro-bias.anonymous-id', '1700000-deadbeef');
    assert(h.pure.UUID_PATTERN.test(h.client.getAnonymousId()));
    const blocked = harness({ blockStorage: true }); assert.doesNotThrow(() => blocked.client.setAnalyticsConsent('granted')); assert(blocked.client.getAnonymousId());
  });
  await check('browser transport strips emails, token URLs and arbitrary error metadata before sending', async () => {
    const h = harness(); h.client.setAnalyticsConsent('granted'); h.client.trackClientEvent({ eventName: 'nav_link_click', subscriberEmail: 'private@example.com',
      metadata: { href: 'https://www.macro-bias.com/today?token=SECRET', email: 'private@example.com', message: 'SECRET', arbitrary: { private: 'SECRET' }, label: 'private@example.com' } });
    const event = (await h.messages()).at(-1), json = JSON.stringify(event); assert(!json.includes('SECRET')); assert(!json.includes('private@example.com')); assert.equal(event.metadata.href, '/today');
  });
  await check('beacon rejection falls back safely; repeated page capture uses same PK', async () => {
    const h = harness({ beaconFails: true }); h.client.trackClientEvent({ eventName: 'page_view' }); h.client.trackClientEvent({ eventName: 'page_view' });
    const [first, second] = await h.messages(); assert.equal(first.eventId, second.eventId);
    await h.route.POST(h.request(first)); await h.route.POST(h.request(second)); assert.equal(h.effects.storedRows, 1);
  });
  await check('public conversion and delivery-ledger spoofing rejected', async () => {
    const h = harness();
    for (const eventName of ['email_signup_success', 'email_subscribed', 'account_created', 'paid_conversion', 'crypto_publication', 'crypto_email_delivery']) {
      const response = await h.route.POST(h.request({ eventId: nav, eventName, pagePath: '/today' })); assert.equal(response.status, 400);
    }
    assert.equal(h.effects.databaseWrites, 0);
  });
  await check('public endpoint derives identity from consent cookie, ignores forged body emails/identity', async () => {
    const h = harness(); h.client.setAnalyticsConsent('granted'); const attr = h.client.getAcquisitionAttribution();
    const response = await h.route.POST(h.request({ eventId: nav, eventName: 'page_view', pagePath: '/crypto?email=private@example.com',
      anonymousId: 'forged', sessionId: 'forged', subscriberEmail: 'private@example.com', utmSource: 'forged', metadata: { attribution: { bad: true }, token: 'SECRET' } }));
    assert.equal(response.status, 202); const event = h.rows.get(nav); assert.equal(event.anonymousId, attr.visitorId); assert.equal(event.utmSource, 'x');
    assert(!JSON.stringify(event).includes('private@example.com')); assert(!JSON.stringify(event).includes('SECRET')); assert.equal(event.pagePath, '/crypto');
  });
  await check('anonymous requests never store forged visitor/session or first/latest linkage', async () => {
    const h = harness(); h.client.trackClientEvent({ eventName: 'page_view' }); const body = (await h.messages())[0];
    body.anonymousId = nav; body.sessionId = nav; body.metadata.attribution = { visitorId: nav }; body.subscriberEmail = 'private@example.com';
    await h.route.POST(h.request(body)); const event = h.rows.get(body.eventId); assert.equal(event.anonymousId, null); assert.equal(event.sessionId, null); assert(!('attribution' in event.metadata));
    assert(!JSON.stringify(event).includes('private@example.com'));
  });
  await check('cross-origin, malformed content and 8KB streaming body limits fail before writes', async () => {
    const h = harness(); const base = { eventId: nav, eventName: 'page_view', pagePath: '/' };
    assert.equal((await h.route.POST(h.request(base, { origin: 'https://evil.example' }))).status, 403);
    assert.equal((await h.route.POST(h.request(base, { 'content-type': 'text/plain' }))).status, 415);
    assert.equal((await h.route.POST(h.request('{bad'))).status, 400);
    assert.equal((await h.route.POST(h.request(JSON.stringify({ ...base, filler: 'x'.repeat(9000) })))).status, 413);
    assert.equal(h.effects.databaseWrites, 0);
  });
  await check('admin, auth, QA/Preview, crawler traffic excluded without writes', async () => {
    const h = harness();
    for (const pagePath of ['/analytics', '/account', '/alerts', '/auth/callback', '/reset-password', '/test/qa']) {
      assert.equal((await h.route.POST(h.request({ eventId: nav, eventName: 'page_view', pagePath }))).status, 202);
    }
    for (const agent of ['Googlebot', 'HeadlessChrome', 'curl/8', 'Lighthouse']) {
      await h.route.POST(h.request({ eventId: nav, eventName: 'page_view', pagePath: '/' }, { 'user-agent': agent }));
    }
    for (const url of ['http://localhost:3000/api/analytics/track', 'https://macro-bias-preview.vercel.app/api/analytics/track']) {
      await h.route.POST(h.request({ eventId: nav, eventName: 'page_view', pagePath: '/' }, {}, url));
    }
    assert.equal(h.effects.databaseWrites, 0);
  });
  await check('the actual public crypto market dashboard remains countable while its private account alias is excluded', async () => {
    const h = harness();
    assert.equal(h.pure.deriveAcquisitionTouch({ url: 'https://www.macro-bias.com/alerts' }), null);
    const touch = h.pure.deriveAcquisitionTouch({ url: 'https://www.macro-bias.com/crypto/dashboard' });
    assert.equal(touch.landingPath, '/crypto/dashboard');
    const response = await h.route.POST(h.request({ eventId: nav, eventName: 'page_view', pagePath: '/crypto/dashboard' }));
    assert.equal(response.status, 202); assert.equal(h.effects.storedRows, 1); assert.equal(h.rows.get(nav).pagePath, '/crypto/dashboard');
  });
  await check('cookie consent marker stable PK and navigation relationship enforced', async () => {
    const h = harness(); h.client.setAnalyticsConsent('granted'); const body = (await h.messages())[0];
    await h.route.POST(h.request(body)); await h.route.POST(h.request(body)); assert.equal(h.effects.storedRows, 1);
    const invalid = { ...body, eventId: nav }; assert.equal((await h.route.POST(h.request(invalid))).status, 400);
  });
  console.log(`Acquisition capture: ${count} scenario groups passed; no external services or credentials used.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
