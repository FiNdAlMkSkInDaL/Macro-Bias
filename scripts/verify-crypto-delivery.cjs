/** Actual delivery helper with isolated atomic database, clock and provider. No remotes or credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const LEASE = 600_000;
const DAY = 86_400_000;
const copy = value => JSON.parse(JSON.stringify(value));
const fixtureRecipient = 'delivery-fixture@example.invalid';
const fixturePayload = recipient => ({ from: 'fixture@example.invalid', to: [recipient], subject: 'Frozen fixture',
  html: '<p>Frozen content</p>', text: 'Frozen content', headers: { 'List-Unsubscribe': '<https://example.invalid/unsubscribe?token=fixture>' } });

function harness(options = {}) {
  let clock = Date.parse('2026-10-04T08:00:00Z');
  const rows = options.rows || new Map(); const writes = []; const calls = []; const effects = options.effects || new Map(); const delays = [];
  const signals = []; const databaseCalls = [];
  let providerIndex = 0; let updateIndex = 0;
  let releaseReceipt;
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  class FixtureSignal {
    constructor(timeoutMs) { this.timeoutMs = timeoutMs; this.expiresAt = clock + timeoutMs; this.aborted = false; this.listeners = new Set(); signals.push(this); }
    static timeout(timeoutMs) { return new FixtureSignal(timeoutMs); }
    addEventListener(_, listener) { this.listeners.add(listener); }
    removeEventListener(_, listener) { this.listeners.delete(listener); }
    abort() { if (this.aborted) return; this.aborted = true; for (const listener of [...this.listeners]) listener(); }
  }
  function advance(value) {
    clock += value;
    for (const signal of signals) if (signal.expiresAt <= clock) signal.abort();
  }
  function field(row, key) {
    return key.startsWith('metadata->>') ? row.metadata[key.slice(11)] : row[key];
  }
  const admin = { from(table) {
    assert.equal(table, 'marketing_event_log');
    let operation = 'select'; let values; let signal; const filters = [];
    const query = {
      select() { return query; },
      eq(key, value) { filters.push(row => field(row, key) === value); return query; },
      insert(value) { operation = 'insert'; values = copy(value); return query; },
      update(value) { operation = 'update'; values = copy(value); return query; },
      abortSignal(value) { signal = value; return query; },
      maybeSingle() { return query; },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    function execute() {
      assert.ok(signal, 'All claim queries must be abortable');
      databaseCalls.push({ operation, timeoutMs: signal.timeoutMs });
      advance(options.databaseDelay?.(operation, values) ?? 0);
      if (signal.aborted) return { data: null, error: { code: 'offline_db_timeout' } };
      if (operation === 'insert') {
        if (options.failInsert) return { data: null, error: { code: 'offline_db_failure' } };
        if (rows.has(values.id)) return { data: null, error: { code: '23505' } };
        rows.set(values.id, copy(values)); writes.push({ kind: operation, row: copy(values) });
        return { data: null, error: null };
      }
      if (operation === 'select' && options.failRead) return { data: null, error: { code: 'offline_db_failure' } };
      const row = [...rows.values()].find(row => filters.every(test => test(row)));
      if (operation === 'update') {
        updateIndex += 1;
        if (options.failUpdate?.(values, updateIndex)) return { data: null, error: { code: 'offline_db_failure' } };
        if (!row) return { data: null, error: null };
        Object.assign(row, copy(values)); writes.push({ kind: operation, row: copy(row) });
        advance(options.afterCommitDelay?.(values) ?? 0);
      }
      return { data: row ? copy(row) : null, error: null };
    }
    return query;
  } };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/crypto-briefing/crypto-delivery.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    Date: FixtureDate, AbortSignal: FixtureSignal,
    setTimeout(fn, delay) { delays.push(delay); advance(delay); fn(); return 0; },
  })(name => {
    if (name === 'server-only') return {};
    if (name === 'node:crypto') return crypto;
    if (name === '../supabase/admin') return { createSupabaseAdminClient: () => admin };
    throw new Error('Unexpected helper dependency');
  }, module, module.exports);
  const resend = { emails: { async send(payload, config) {
    assert.ok(config.signal, 'Provider request must carry an actual fetch signal');
    const call = { payload: copy(payload), key: config.idempotencyKey, startedAt: clock, timeoutMs: config.signal.timeoutMs };
    calls.push(call);
    const index = providerIndex++;
    const response = options.responses?.[index];
    if (response === 'throw') throw new Error('Offline uncertain provider fixture');
    if (response) return copy(response);
    if (!effects.has(call.key)) effects.set(call.key, `provider-fixture-${effects.size + 1}`);
    advance(options.providerDelay ?? 0);
    if (config.signal.aborted && !options.ignoreProviderAbort) return { data: null, error: { name: 'application_error', statusCode: null }, headers: null };
    if (options.deferReceipt && index === 0) await new Promise(resolve => { releaseReceipt = resolve; });
    return { data: { id: effects.get(call.key) }, error: null, headers: null };
  } } };
  const send = (recipient = fixtureRecipient, payload = fixturePayload(recipient), tradeDate = '2026-10-03', deadlineAt) =>
    module.exports.sendCryptoEmailOnce({ tradeDate, recipient, payload, resend: options.resend ?? resend, deadlineAt });
  return { ...module.exports, rows, writes, calls, effects, delays, signals, databaseCalls, options, send,
    releaseProviderReceipt() { releaseReceipt(); },
    advance, now() { return clock; },
    delivery() { return [...rows.values()].find(row => row.event_name === 'crypto_email_delivery'); },
  };
}

const groups = [];
async function group(name, test) {
  try { await test(); groups.push({ name, passed: true }); }
  catch { groups.push({ name, passed: false }); }
}
(async () => {
  await group('Concurrent publication insert grants one owner, including weekend dates', async () => {
    const h = harness(); const claims = await Promise.all([h.claimCryptoPublication('2026-10-03'), h.claimCryptoPublication('2026-10-03')]);
    assert.equal(claims.filter(c => c.claimed).length, 1);
    assert.equal(new Set(claims.map(c => c.id)).size, 1);
    assert.equal((await h.claimCryptoPublication('2026-10-04')).claimed, true);
    assert.equal(h.rows.size, 2);
  });
  await group('Completed publication remains completed permanently', async () => {
    const h = harness(); const claim = await h.claimCryptoPublication('2026-10-03');
    await h.finishCryptoPublication(claim, 'completed', { recipientsAccepted: 1 }); h.advance(365 * DAY);
    const next = await h.claimCryptoPublication('2026-10-03'); assert.equal(next.claimed, false); assert.equal(next.completed, true);
  });
  await group('Ten-minute lease takeover is atomic and fences stale owners', async () => {
    const h = harness(); const original = await h.claimCryptoPublication('2026-10-03');
    h.advance(LEASE - 1); assert.equal((await h.claimCryptoPublication('2026-10-03')).claimed, false); h.advance(1);
    const next = await Promise.all([h.claimCryptoPublication('2026-10-03'), h.claimCryptoPublication('2026-10-03')]);
    assert.equal(next.filter(c => c.claimed).length, 1);
    await assert.rejects(() => h.finishCryptoPublication(original, 'completed', {}));
    const winner = next.find(c => c.claimed); await h.finishCryptoPublication(winner, 'published', {});
    const retry = await h.claimCryptoPublication('2026-10-03'); assert.equal(retry.claimed, true);
    await h.finishCryptoPublication(retry, 'failed', {}); assert.equal((await h.claimCryptoPublication('2026-10-03')).claimed, true);
  });
  await group('Publication database failures cannot masquerade as a claim', async () => {
    const h = harness({ failInsert: true }); await assert.rejects(() => h.claimCryptoPublication('2026-10-03')); assert.equal(h.rows.size, 0);
  });
  await group('Provider ID and frozen payload persist; accepted recipients skip forever', async () => {
    const h = harness(); const payload = fixturePayload(fixtureRecipient); const first = await h.send(fixtureRecipient, payload);
    assert.equal(first.status, 'accepted'); assert.equal(first.emailId, 'provider-fixture-1');
    const row = h.delivery(); assert.equal(row.metadata.email_id, first.emailId); assert.deepEqual(copy(row.metadata.payload), payload);
    assert.equal(h.calls[0].key.includes('@'), false); payload.subject = 'Changed later'; h.advance(365 * DAY);
    const next = await h.send(fixtureRecipient, payload); assert.equal(next.status, 'already_accepted'); assert.equal(next.emailId, first.emailId); assert.equal(h.calls.length, 1);
  });
  await group('Recipient normalization and concurrent insert cannot send twice', async () => {
    const h = harness(); const upper = fixtureRecipient.toUpperCase();
    const results = await Promise.all([h.send(upper, fixturePayload(upper)), h.send()]);
    assert.equal(results.filter(r => r.status === 'accepted').length, 1); assert.equal(h.calls.length, 1); assert.equal(h.rows.size, 1);
  });
  await group('Known 400 rejection retries exact frozen content and idempotency key', async () => {
    const h = harness({ responses: [{ data: null, error: { name: 'validation_error', statusCode: 400, message: 'Do not return provider prose' }, headers: null }] });
    assert.equal((await h.send()).status, 'failed'); const initial = h.calls[0]; const firstTime = h.delivery().metadata.first_attempt_at;
    const changed = fixturePayload(fixtureRecipient); changed.subject = 'Different generated copy';
    assert.equal((await h.send(fixtureRecipient, changed)).status, 'accepted');
    assert.deepEqual(h.calls[1].payload, initial.payload); assert.equal(h.calls[1].key, initial.key); assert.equal(h.delivery().metadata.first_attempt_at, firstTime);
    assert.equal(JSON.stringify(h.delivery().metadata).includes('Do not return provider prose'), false);
  });
  await group('Unknown provider exception holds lease and replays safely after expiry', async () => {
    const h = harness({ responses: ['throw'] }); assert.equal((await h.send()).status, 'uncertain');
    assert.equal((await h.send()).status, 'in_progress'); const frozen = copy(h.delivery().metadata); h.advance(LEASE + 1);
    const results = await Promise.all([h.send(), h.send()]); assert.equal(results.filter(r => r.status === 'accepted').length, 1);
    assert.equal(h.calls.length, 2); assert.equal(h.calls[1].key, h.calls[0].key); assert.deepEqual(h.calls[1].payload, h.calls[0].payload);
    assert.equal(h.delivery().metadata.first_attempt_at, frozen.first_attempt_at);
  });
  await group('Lost database receipt replays one provider effect and records actual ID', async () => {
    const h = harness({ failUpdate: value => value.metadata.state === 'accepted' }); const first = await h.send();
    assert.equal(first.status, 'uncertain'); assert.equal(first.emailId, 'provider-fixture-1'); assert.equal(h.delivery().metadata.state, 'sending');
    h.options.failUpdate = undefined; h.advance(LEASE + 1); assert.equal((await h.send()).status, 'accepted');
    assert.equal(h.effects.size, 1); assert.equal(h.calls.length, 2); assert.equal(h.delivery().metadata.email_id, first.emailId);
  });
  await group('Independent processes fence stale provider receipts after lease takeover', async () => {
    const rows = new Map(); const effects = new Map();
    const original = harness({ rows, effects, deferReceipt: true }); const pending = original.send();
    for (let attempts = 0; original.calls.length === 0 && attempts < 50; attempts++) await Promise.resolve();
    assert.equal(original.calls.length, 1); const oldOwner = original.delivery().metadata.owner;
    const successor = harness({ rows, effects }); successor.advance(LEASE + 1);
    const next = await successor.send(); assert.equal(next.status, 'accepted'); assert.notEqual(successor.delivery().metadata.owner, oldOwner);
    original.advance(LEASE + 1); original.releaseProviderReceipt(); assert.equal((await pending).status, 'uncertain');
    assert.equal(successor.delivery().metadata.state, 'accepted'); assert.equal(successor.delivery().metadata.email_id, next.emailId); assert.equal(effects.size, 1);
  });
  await group('Lost receipt held beyond provider retention cannot create another effect', async () => {
    const h = harness({ failUpdate: value => value.metadata.state === 'accepted' });
    assert.equal((await h.send()).status, 'uncertain'); h.options.failUpdate = undefined; h.advance(DAY);
    assert.equal((await h.send()).status, 'uncertain'); assert.equal(h.calls.length, 1); assert.equal(h.effects.size, 1);
  });
  await group('Unknown attempt at 24 hours is fail-closed without provider replay', async () => {
    const h = harness({ responses: ['throw'] }); await h.send(); h.advance(DAY);
    assert.equal((await h.send()).status, 'uncertain'); assert.equal(h.calls.length, 1);
  });
  await group('Crossing replay expiry while waiting for throttle cannot send', async () => {
    const h = harness({ responses: ['throw'] }); await h.send(); const old = h.delivery();
    h.advance(DAY - 500); await h.send('other-fixture@example.invalid');
    const before = h.calls.length; assert.equal((await h.send()).status, 'uncertain'); assert.equal(h.calls.length, before);
    assert.equal(old.metadata.first_attempt_at, h.delivery().metadata.first_attempt_at);
  });
  await group('Unattempted crash preserves payload and may recover beyond 24 hours', async () => {
    const h = harness({ failUpdate: () => true }); assert.equal((await h.send()).status, 'failed'); assert.equal(h.calls.length, 0);
    const frozen = copy(h.delivery().metadata.payload); assert.equal(h.delivery().metadata.first_attempt_at, null);
    h.options.failUpdate = undefined; h.advance(2 * DAY); const changed = fixturePayload(fixtureRecipient); changed.text = 'Changed text';
    assert.equal((await h.send(fixtureRecipient, changed)).status, 'accepted'); assert.deepEqual(h.calls[0].payload, frozen);
  });
  await group('Insert/read/pre-effect state failures block provider calls', async () => {
    const insert = harness({ failInsert: true }); assert.equal((await insert.send()).status, 'failed'); assert.equal(insert.calls.length, 0);
    const update = harness({ failUpdate: () => true }); assert.equal((await update.send()).status, 'failed'); assert.equal(update.calls.length, 0);
    update.options.failRead = true; assert.equal((await update.send()).status, 'failed'); assert.equal(update.calls.length, 0);
  });
  await group('Provider 5xx and idempotency conflicts stay uncertain', async () => {
    for (const [name, statusCode] of [['internal_server_error', 500], ['invalid_idempotent_request', 409], ['concurrent_idempotent_requests', 409]]) {
      const h = harness({ responses: [{ data: null, error: { name, statusCode, message: 'Private fixture prose' }, headers: null }] });
      assert.equal((await h.send()).status, 'uncertain'); assert.equal(h.delivery().metadata.state, 'uncertain');
      assert.equal((await h.send()).status, 'in_progress'); assert.equal(h.calls.length, 1);
    }
  });
  await group('Missing provider ID is never counted as accepted', async () => {
    const h = harness({ responses: [{ data: {}, error: null, headers: null }] });
    assert.equal((await h.send()).status, 'uncertain'); assert.equal(h.delivery().metadata.state, 'uncertain');
  });
  await group('Individual provider attempts are separated by 550ms', async () => {
    const h = harness(); await Promise.all(['one', 'two', 'three'].map(name => h.send(`${name}@example.invalid`)));
    assert.equal(h.calls.length, 3); assert.equal(h.calls[1].startedAt - h.calls[0].startedAt >= 550, true); assert.equal(h.calls[2].startedAt - h.calls[1].startedAt >= 550, true);
  });
  await group('Corrupt dates, multi-recipient payload and corrupted claims fail closed', async () => {
    const h = harness(); const payload = fixturePayload(fixtureRecipient); payload.to.push('other@example.invalid');
    assert.equal((await h.send(fixtureRecipient, payload)).status, 'failed'); assert.equal((await h.send(fixtureRecipient, fixturePayload(fixtureRecipient), '2026-02-30')).status, 'failed');
    assert.equal(h.calls.length, 0); h.options.responses = ['throw']; await h.send(); h.advance(LEASE + 1);
    h.delivery().metadata.first_attempt_at = 'invalid'; assert.equal((await h.send()).status, 'uncertain'); assert.equal(h.calls.length, 1);
  });
  await group('Publication and delivery database reads and writes use five-second aborts, including finish grace', async () => {
    const h = harness(); const claim = await h.claimCryptoPublication('2026-10-03', h.now() + 270_000);
    await h.claimCryptoPublication('2026-10-03', h.now() + 270_000);
    await h.send(); await h.send(); h.advance(270_000);
    await h.finishCryptoPublication(claim, 'completed', { accepted: 1 });
    assert.ok(h.databaseCalls.length >= 9); assert.ok(h.databaseCalls.every(call => call.timeoutMs === 5_000));
    assert.equal([...h.rows.values()].find(row => row.event_name === 'crypto_publication').metadata.state, 'completed');
  });
  await group('Provider aborts are ten seconds or the shorter remaining absolute deadline', async () => {
    const regular = harness(); assert.equal((await regular.send()).status, 'accepted'); assert.equal(regular.calls[0].timeoutMs, 10_000);
    const short = harness(); assert.equal((await short.send(fixtureRecipient, fixturePayload(fixtureRecipient), '2026-10-03', short.now() + 2_500)).status, 'accepted');
    assert.equal(short.calls[0].timeoutMs, 2_500); assert.equal(short.databaseCalls[0].timeoutMs, 2_500);
  });
  await group('Provider timeout retains uncertain payload and key for one safe replay', async () => {
    const h = harness({ providerDelay: 10_000 }); const first = await h.send(); assert.equal(first.status, 'uncertain');
    assert.equal(h.delivery().metadata.state, 'uncertain'); const frozen = copy(h.delivery().metadata);
    h.options.providerDelay = 0; h.advance(LEASE + 1);
    const changed = fixturePayload(fixtureRecipient); changed.subject = 'Must not replace frozen subject';
    assert.equal((await h.send(fixtureRecipient, changed)).status, 'accepted');
    assert.deepEqual(h.calls[1].payload, frozen.payload); assert.equal(h.calls[1].key, frozen.idempotency_key); assert.equal(h.effects.size, 1);
  });
  await group('Expired cutoff and database abort stop before provider effects', async () => {
    const expired = harness(); assert.equal((await expired.send(fixtureRecipient, fixturePayload(fixtureRecipient), '2026-10-03', expired.now())).status, 'uncertain');
    assert.equal(expired.rows.size, 0); assert.equal(expired.databaseCalls.length, 0); assert.equal(expired.calls.length, 0);
    const stalled = harness({ databaseDelay: () => 5_000 }); assert.equal((await stalled.send()).status, 'failed');
    assert.equal(stalled.rows.size, 0); assert.equal(stalled.calls.length, 0);
  });
  await group('Queued cutoff cancels the turn and never starts a later send', async () => {
    const h = harness({ deferReceipt: true }); const first = h.send();
    for (let attempts = 0; h.calls.length === 0 && attempts < 50; attempts++) await Promise.resolve();
    const secondRecipient = 'queued-fixture@example.invalid'; const frozen = fixturePayload(secondRecipient);
    const queued = h.send(secondRecipient, frozen, '2026-10-03', h.now() + 100);
    for (let attempt = 0; h.rows.size < 2 && attempt < 50; attempt++) await Promise.resolve();
    for (let attempt = 0; h.signals.every(signal => signal.timeoutMs !== 100) && attempt < 50; attempt++) await Promise.resolve();
    h.advance(100); assert.equal((await queued).status, 'uncertain'); assert.equal(h.calls.length, 1);
    h.releaseProviderReceipt(); assert.equal((await first).status, 'accepted');
    for (let attempt = 0; attempt < 10; attempt++) await Promise.resolve(); assert.equal(h.calls.length, 1);
    h.advance(LEASE + 1); const changed = { ...frozen, subject: 'Changed after cutoff' };
    assert.equal((await h.send(secondRecipient, changed)).status, 'accepted'); assert.deepEqual(h.calls[1].payload, frozen);
  });
  await group('Cutoff after sending CAS prevents provider effect and retains frozen claim', async () => {
    const h = harness({ afterCommitDelay: values => values.metadata.state === 'sending' ? 100 : 0 });
    assert.equal((await h.send(fixtureRecipient, fixturePayload(fixtureRecipient), '2026-10-03', h.now() + 100)).status, 'uncertain');
    assert.equal(h.calls.length, 0); assert.equal(h.delivery().metadata.state, 'uncertain'); assert.ok(h.delivery().metadata.payload);
  });
  await group('Known provider receipt persists with fixed database grace after work cutoff', async () => {
    const h = harness({ providerDelay: 100, ignoreProviderAbort: true });
    assert.equal((await h.send(fixtureRecipient, fixturePayload(fixtureRecipient), '2026-10-03', h.now() + 100)).status, 'accepted');
    assert.equal(h.delivery().metadata.email_id, 'provider-fixture-1'); assert.equal(h.databaseCalls.at(-1).timeoutMs, 5_000);
  });
  await group('Installed Resend SDK forwards the helper signal and treats aborted response bodies as uncertain', async () => {
    const originalFetch = globalThis.fetch; const { Resend } = require('resend'); const h = harness({ resend: new Resend('offline-fixture-key') });
    let providerRequests = 0;
    try {
      globalThis.fetch = async (_, init) => {
        providerRequests += 1; assert.ok(init.signal); assert.equal(init.signal.timeoutMs, 10_000);
        assert.ok(new Headers(init.headers).get('Idempotency-Key'));
        return { ok: true, headers: new Headers(), async json() { h.advance(10_000); assert.equal(init.signal.aborted, true); throw new Error('Offline body abort'); } };
      };
      assert.equal((await h.send()).status, 'uncertain'); assert.equal(providerRequests, 1); assert.equal(h.delivery().metadata.state, 'uncertain');
      assert.deepEqual(copy(h.delivery().metadata.payload), fixturePayload(fixtureRecipient));
    } finally { globalThis.fetch = originalFetch; }
  });
  const passed = groups.every(g => g.passed);
  console.log(JSON.stringify({ passed, groups: groups.length, failures: groups.filter(g => !g.passed).map(g => g.name), remoteCalls: 0 }));
  process.exitCode = passed ? 0 : 1;
})();
