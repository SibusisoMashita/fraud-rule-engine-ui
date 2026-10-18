import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { parse, stringify } from 'lossless-json';
import { waitForReady } from './readiness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.resolve(
  process.env.BACKEND_PROJECT_DIR ?? path.join(root, '..', 'fraud-rule-engine-service'),
);
const source = JSON.parse(await readFile(path.join(root, 'api/source.json'), 'utf8'));
const suffix = randomBytes(6).toString('hex');
const project = `fraud-ui-check-${suffix}`;
const uiProject = `${project}-web`;
const directory = await mkdtemp(path.join(tmpdir(), `${project}-`));
await chmod(directory, 0o700);
const secrets = [];
const backendFile = path.join(directory, 'backend.json');
const uiFile = path.join(directory, 'ui.json');
const backendImage = `fraud-ui-backend-check:${suffix}`;
const uiImage = `fraud-ui-check:${suffix}`;
const adminKey = `policy-admin.${randomBytes(32).toString('hex')}`;
const apiKey = `local.${randomBytes(32).toString('hex')}`;
const revokedSecret = randomBytes(32).toString('hex');
const revokedKey = `revoked.${revokedSecret}`;
const readOnlySecret = randomBytes(32).toString('hex');
const readOnlyKey = `readonly.${readOnlySecret}`;
const policyKeys = Object.fromEntries(
  ['forms', 'invalid', 'unchanged', 'concurrent', 'unknown', 'permissions', 'rate', 'live'].map(
    (name) => [name, `ui-policy-${name}.${randomBytes(32).toString('hex')}`],
  ),
);
secrets.push(adminKey, apiKey, revokedKey, readOnlyKey, ...Object.values(policyKeys));

function safe(value) {
  let result = String(value);
  for (const secret of secrets) result = result.replaceAll(secret, '[REDACTED]');
  return result;
}

async function run(command, args, { cwd = root, env = {}, input, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!quiet) process.stdout.write(safe(chunk));
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!quiet && input === undefined) process.stderr.write(safe(chunk));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `${command} ${args.slice(0, 2).join(' ')} failed (${code}): ${input === undefined ? safe(stderr.slice(-2_000)) : 'stdin command diagnostics withheld'}`,
          ),
        );
    });
    child.stdin.end(input);
  });
}

const compose = (...args) => run('docker', ['compose', '-p', project, '-f', backendFile, ...args]);
const web = (...args) => run('docker', ['compose', '-p', uiProject, '-f', uiFile, ...args]);
const sql = (query) =>
  run(
    'docker',
    [
      'compose',
      '-p',
      project,
      '-f',
      backendFile,
      'exec',
      '-T',
      'db',
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'fraud',
      '-At',
    ],
    { input: query, quiet: true },
  );
const ready = (url, headers) => waitForReady(url, { headers });

async function api(
  base,
  endpoint,
  { method = 'GET', body, key = apiKey, expectedStatus = method === 'POST' ? 201 : 200 } = {},
) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: { 'X-API-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  assert.equal(
    response.status,
    expectedStatus,
    `${method} ${endpoint} returned ${response.status}`,
  );
  return text;
}

async function policy(base, { document, etag, key = adminKey } = {}) {
  const response = await fetch(`${base}/api/v1/admin/policy`, {
    method: document ? 'PUT' : 'GET',
    headers: {
      'X-API-Key': key,
      ...(document ? { 'Content-Type': 'application/json', 'If-Match': etag } : {}),
    },
    ...(document ? { body: stringify(document) } : {}),
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  });
  const raw = await response.text();
  assert.equal(response.status, 200, `Policy ${document ? 'activation' : 'read'} failed`);
  const revisionEtag = response.headers.get('etag');
  assert.match(revisionEtag ?? '', /^"policy-revision-[1-9]\d*"$/);
  return { data: parse(raw), etag: revisionEtag };
}

let base;
let ui;
let fixture;
let precisePayload;
let backendConfigured = false;
let uiConfigured = false;
async function browser(phase) {
  console.log(`\nBrowser verification: ${phase}`);
  const selection = {
    foundation:
      'persisted evaluations|policy inspection|authentication, revocation|keys stay in memory',
    playground: 'playground:',
    policy: 'policy:',
    'rate-limit': 'a real rate limit',
    'dependency-down': 'an unavailable real dependency',
    recovered: 'dependency recovery and proxy DNS',
    recreated: 'dependency recovery and proxy DNS',
    balanced: 'dependency recovery and proxy DNS',
  }[phase];
  await run(
    process.execPath,
    [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--grep', selection],
    {
      env: {
        E2E_PHASE: phase,
        E2E_BASE_URL: ui,
        E2E_API_KEY: apiKey,
        E2E_ADMIN_KEY: adminKey,
        E2E_REVOKED_KEY: revokedKey,
        E2E_READONLY_KEY: readOnlyKey,
        E2E_POLICY_KEYS: JSON.stringify(policyKeys),
        E2E_FIXTURE: JSON.stringify(fixture),
      },
    },
  );
}

try {
  console.log(`Disposable Docker projects: ${project} and ${uiProject}`);
  await chromium
    .launch()
    .then((browser) => browser.close())
    .catch(() => {
      throw new Error(
        'Install the pinned browser before Docker verification: npx playwright install chromium',
      );
    });
  assert.equal(
    await run('git', ['rev-parse', 'HEAD'], { cwd: backend, quiet: true }),
    source.commit,
    'Backend checkout must match api/source.json; check out its recorded commit.',
  );
  assert.equal(
    await run('git', ['status', '--porcelain'], { cwd: backend, quiet: true }),
    '',
    'Use a clean backend checkout for release verification.',
  );
  assert.equal(
    createHash('sha256')
      .update(await readFile(path.join(backend, source.path)))
      .digest('hex'),
    source.sha256,
    'The pinned backend contract checksum changed.',
  );
  await run('docker', ['info'], { quiet: true });
  const config = JSON.parse(
    await run(
      'docker',
      ['compose', '-f', 'compose.yaml', '-f', 'compose.ui-demo.yaml', 'config', '--format', 'json'],
      { cwd: backend, quiet: true },
    ),
  );
  config.name = project;
  for (const section of ['volumes', 'networks']) {
    for (const [name, value] of Object.entries(config[section] ?? {})) {
      assert(!value.external, 'Backend verification cannot attach external resources');
      value.name = `${project}_${name}`;
    }
  }
  for (const [name, definition] of Object.entries(config.secrets)) {
    const value =
      name === 'local-api-key'
        ? apiKey
        : name === 'local-policy-admin-api-key'
          ? adminKey
          : randomBytes(32).toString('hex');
    secrets.push(value);
    const file = path.join(directory, name);
    await writeFile(file, `${value}\n`, { mode: 0o444 });
    definition.file = file;
  }
  for (const service of Object.values(config.services)) {
    if (service.build) {
      service.image = backendImage;
      delete service.build;
    }
  }
  config.services.app.ports = [
    { target: 8080, published: '0', host_ip: '127.0.0.1', protocol: 'tcp' },
  ];
  await writeFile(backendFile, JSON.stringify(config));
  backendConfigured = true;
  console.log('Building isolated, pinned backend artifact');
  await run('docker', ['build', '--tag', backendImage, '.'], { cwd: backend });
  await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'app');
  base = `http://${(await compose('port', 'app', '8080')).trim()}`;
  await ready(`${base}/health/ready`);
  await sql(`INSERT INTO fraud.api_credentials(key_id,principal_id,secret_hash,valid_from,expires_at,revoked)
    VALUES ('revoked','local-demo','${createHash('sha256').update(revokedSecret).digest('hex')}',clock_timestamp(),clock_timestamp()+interval '1 day',true);
    INSERT INTO fraud.api_principals(principal_id,scope,enabled,roles,location_sources)
    VALUES ('ui-readonly','local-demo',true,ARRAY['READ','POLICY'],ARRAY[]::text[]);
    INSERT INTO fraud.api_credentials(key_id,principal_id,secret_hash,valid_from,expires_at)
    VALUES ('readonly','ui-readonly','${createHash('sha256').update(readOnlySecret).digest('hex')}',clock_timestamp(),clock_timestamp()+interval '1 day');`);
  await sql(
    Object.values(policyKeys)
      .map((credential) => {
        const [id, secret] = credential.split('.');
        const hash = createHash('sha256').update(secret).digest('hex');
        return `INSERT INTO fraud.api_principals(principal_id,scope,enabled,roles,location_sources)
          VALUES ('${id}','global-policy',true,ARRAY['POLICY_ADMIN'],ARRAY[]::text[]);
          INSERT INTO fraud.api_credentials(key_id,principal_id,secret_hash,valid_from,expires_at)
          VALUES ('${id}','${id}','${hash}',clock_timestamp(),clock_timestamp()+interval '1 day');`;
      })
      .join('\n'),
  );
  const initialPolicy = await policy(base);

  const now = Date.now();
  fixture = {
    customer: 'ui-walkthrough-customer',
    preciseEvent: 'ui-precise-event',
    flaggedEvent: 'ui-flagged-event',
    precision: '0.12345678901234567890123456789',
    acceptedFrom: new Date(now - 60_000).toISOString(),
    acceptedTo: new Date(now + 3_600_000).toISOString(),
  };
  for (const [index, eventId] of [
    'ui-first-event',
    fixture.preciseEvent,
    fixture.flaggedEvent,
    'ui-final-event',
  ].entries()) {
    const customerId = eventId === fixture.flaggedEvent ? 'ui-flagged-customer' : fixture.customer;
    const event = {
      eventId,
      customerId,
      instrumentId: `card-${customerId}`,
      transactionType: 'CARD_PURCHASE',
      status: 'BOOKED',
      channel: 'CARD_PRESENT',
      amount: eventId === fixture.flaggedEvent ? '35000.00' : '100.00',
      currency: 'ZAR',
      category: 'SYNTHETIC_UI_CHECK',
      occurredAt: new Date(now - (4 - index) * 60_000).toISOString(),
      physicalLocation: {
        latitude: -33.9249,
        longitude: 18.4241,
        accuracyKm: '__EXACT__',
        source: 'VERIFIED_CARD_PRESENT_TERMINAL',
        city: 'Cape Town',
      },
    };
    const body = JSON.stringify(event).replace('"__EXACT__"', fixture.precision);
    if (eventId === fixture.preciseEvent) precisePayload = body;
    await api(base, '/api/v1/transactions', {
      method: 'POST',
      body,
    });
  }
  assert(
    (await api(base, `/api/v1/transactions/${fixture.preciseEvent}`)).includes(fixture.precision),
    'Backend detail precision fixture was not retained',
  );
  assert(
    (await api(base, '/api/v1/evaluations')).includes(fixture.precision),
    'Backend list precision fixture was not retained',
  );

  const uiConfig = JSON.parse(
    await run('docker', ['compose', '-f', 'compose.yaml', 'config', '--format', 'json'], {
      env: {
        UI_PORT: '0',
        UI_IMAGE: uiImage,
        BACKEND_NETWORK: `${project}_default`,
        API_UPSTREAM: 'app:8080',
      },
      quiet: true,
    }),
  );
  assert.deepEqual(
    Object.keys(uiConfig.services),
    ['ui'],
    'UI verification owns only its ui service',
  );
  assert.equal(
    uiConfig.networks.backend.name,
    `${project}_default`,
    'UI verification must join its disposable backend network',
  );
  uiConfig.name = uiProject;
  uiConfig.services.ui.ports = [
    { target: 8080, published: '0', host_ip: '127.0.0.1', protocol: 'tcp' },
  ];
  await writeFile(uiFile, JSON.stringify(uiConfig));
  uiConfigured = true;
  await web('up', '-d', '--build', '--wait', '--wait-timeout', '60');
  ui = `http://${(await web('port', 'ui', '8080')).trim()}`;
  await ready(`${ui}/health/live`);
  console.log(`Disposable UI is ready: ${ui}`);
  await browser('foundation');
  await browser('playground');
  await browser('policy');
  const editedPolicy = await policy(base);
  if (editedPolicy.data.policyHash !== initialPolicy.data.policyHash) {
    const restored = await policy(base, {
      document: initialPolicy.data.document,
      etag: editedPolicy.etag,
    });
    assert.equal(
      restored.data.policyHash,
      initialPolicy.data.policyHash,
      'Policy fixture was not restored',
    );
  }
  await browser('rate-limit');

  await compose('stop', 'redis');
  await browser('dependency-down');
  await compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '60', 'redis');
  await ready(`${base}/health/ready`);
  await browser('recovered');

  const original = await compose('ps', '-q', 'app');
  const uiBefore = await web('ps', '-q', 'ui');
  const address = (container) =>
    run(
      'docker',
      [
        'inspect',
        '--format',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        container,
      ],
      { quiet: true },
    );
  const originalAddress = await address(original);
  config.services.replacement = structuredClone(config.services.app);
  config.services.replacement.networks = { default: { aliases: ['app'] } };
  await writeFile(backendFile, JSON.stringify(config));
  await compose(
    'up',
    '-d',
    '--no-build',
    '--no-deps',
    '--wait',
    '--wait-timeout',
    '120',
    'replacement',
  );
  const replacementAddress = await address(await compose('ps', '-q', 'replacement'));
  assert(originalAddress && replacementAddress, 'Both backend containers need network addresses');
  assert.notEqual(
    originalAddress,
    replacementAddress,
    'DNS regression requires different backend IP addresses',
  );
  await compose('stop', 'app');
  await compose('rm', '-f', 'app');
  assert.equal(
    await web('ps', '-q', 'ui'),
    uiBefore,
    'DNS verification must preserve the running UI container',
  );
  console.log(
    `DNS replacement: ${originalAddress} -> ${replacementAddress}; UI container unchanged: ${uiBefore}`,
  );
  // Both aliases can be cached during the handoff. One successful read does not
  // prove that the next request cannot still target the retired address.
  await waitForReady(`${ui}/api/v1/evaluations?pageSize=1`, {
    headers: { 'X-API-Key': apiKey },
    stableForMs: 10_000, // Cover two refreshes of the proxy's five-second DNS cache.
  });
  await browser('recreated');
  await compose('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120', 'app');
  await compose('stop', 'replacement');
  await compose('rm', '-f', 'replacement');
  delete config.services.replacement;
  await writeFile(backendFile, JSON.stringify(config));

  const balanced = JSON.parse(
    await run(
      'docker',
      [
        'compose',
        '-f',
        'compose.yaml',
        '-f',
        'compose.balanced.yaml',
        'config',
        '--format',
        'json',
      ],
      { cwd: backend, quiet: true },
    ),
  );
  config.services['load-balancer'] = balanced.services['load-balancer'];
  delete config.services['load-balancer'].ports;
  config.services['load-balancer'].environment.FRAUD_DEMO_HEADERS = 'true';
  await writeFile(backendFile, JSON.stringify(config));
  await compose(
    'up',
    '-d',
    '--no-build',
    '--scale',
    'app=2',
    '--wait',
    '--wait-timeout',
    '120',
    'load-balancer',
  );
  uiConfig.services.ui.environment.API_UPSTREAM = 'load-balancer:8080';
  await writeFile(uiFile, JSON.stringify(uiConfig));
  await web('up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '60');
  ui = `http://${(await web('port', 'ui', '8080')).trim()}`;
  await ready(`${ui}/health/live`);
  await ready(`${ui}/api/v1/evaluations`, { 'X-API-Key': apiKey });
  const servedBy = new Set();
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`${ui}/api/v1/evaluations`, { headers: { 'X-API-Key': apiKey } });
    assert.equal(response.status, 200, 'Balanced proxy read failed');
    servedBy.add(response.headers.get('x-demo-backend'));
    await response.arrayBuffer();
  }
  assert(
    servedBy.size > 1 && !servedBy.has(null),
    'Balanced verification must reach two distinct ready app instances',
  );
  const instances = (await compose('ps', '-q', 'app')).split('\n').filter(Boolean).sort();
  assert.equal(instances.length, 2, 'Live policy verification requires two app instances');
  const liveKey = policyKeys.live;
  const beforeLive = await policy(ui, { key: liveKey });
  const originalResult = await api(ui, `/api/v1/transactions/${fixture.preciseEvent}`);
  const saved = parse(originalResult);
  assert.equal(saved.evaluation.policyHash, beforeLive.data.policyHash);
  assert.equal(
    saved.evaluation.ruleResults.find((rule) => rule.ruleId === 'HIGH_AMOUNT').status,
    'NO_MATCH',
  );
  const candidate = parse(stringify(beforeLive.data.document));
  const currency = saved.transaction.currency;
  const scale = Number(candidate.supportedCurrencies[currency].scale.toString());
  candidate.rules.highAmount.thresholds[currency] =
    scale === 0 ? '1' : `0.${'0'.repeat(scale - 1)}1`;
  assert.notEqual(
    candidate.rules.highAmount.thresholds[currency],
    beforeLive.data.document.rules.highAmount.thresholds[currency],
  );
  const validation = parse(
    await api(ui, '/api/v1/admin/policy/validate', {
      method: 'POST',
      body: stringify(candidate),
      key: liveKey,
      expectedStatus: 200,
    }),
  );
  const activated = await policy(ui, { document: candidate, etag: beforeLive.etag, key: liveKey });
  assert.equal(activated.data.policyHash, validation.policyHash);
  assert.notEqual(activated.etag, beforeLive.etag, 'Changed policy must advance the revision');
  try {
    for (const instance of instances) {
      const endpoint = `http://${await run('docker', ['port', instance, '8080/tcp'], { quiet: true })}`;
      const rules = parse(await api(endpoint, '/api/v1/rules'));
      assert.equal(
        rules.policyHash,
        activated.data.policyHash,
        'Each instance must see live policy',
      );
      const event = {
        ...saved.transaction,
        eventId: `ui-live-policy-${randomUUID()}`,
        customerId: `ui-live-customer-${randomUUID()}`,
        instrumentId: `ui-live-card-${randomUUID()}`,
        occurredAt: new Date().toISOString(),
      };
      const evaluated = parse(
        await api(endpoint, '/api/v1/transactions', {
          method: 'POST',
          body: stringify(event),
        }),
      );
      assert.equal(evaluated.evaluation.policyHash, activated.data.policyHash);
      assert.equal(
        evaluated.evaluation.ruleResults.find((rule) => rule.ruleId === 'HIGH_AMOUNT').status,
        'MATCH',
      );
      assert.equal(
        await api(endpoint, `/api/v1/transactions/${fixture.preciseEvent}`),
        originalResult,
        'Saved evidence must keep its original policy',
      );
      assert.equal(
        await api(endpoint, '/api/v1/transactions', {
          method: 'POST',
          body: precisePayload,
          expectedStatus: 200,
        }),
        originalResult,
        'Identical replay must preserve the original result',
      );
    }
    assert.deepEqual(
      (await compose('ps', '-q', 'app')).split('\n').filter(Boolean).sort(),
      instances,
      'Live policy changes must not restart app instances',
    );
  } finally {
    const restored = await policy(ui, {
      document: beforeLive.data.document,
      etag: activated.etag,
      key: liveKey,
    });
    assert.equal(restored.data.policyHash, beforeLive.data.policyHash);
  }
  console.log(
    'Live policy changed across two running app instances; stored results and identical replays retained their original policy.',
  );
  await browser('balanced');
  console.log(
    '\nDocker UI verification passed: persisted reads, permissions, precision, quotas, dependency recovery, backend DNS recreation and two-instance balancing.',
  );
} catch (error) {
  // Keep bounded proxy diagnostics before cleanup removes the failed container.
  if (uiConfigured)
    await web('logs', '--no-color', '--tail', '30', 'ui').catch(() =>
      console.error('UI proxy diagnostics were unavailable.'),
    );
  throw error;
} finally {
  // These names were generated by this process. Never operate on the developer stack.
  const cleanupFailures = [];
  if (uiConfigured)
    await web('down', '--volumes', '--remove-orphans').catch((error) =>
      cleanupFailures.push(error),
    );
  if (backendConfigured)
    await compose('down', '--volumes', '--remove-orphans').catch((error) =>
      cleanupFailures.push(error),
    );
  await run('docker', ['image', 'rm', uiImage, backendImage], { quiet: true }).catch(() => {});
  await rm(directory, { recursive: true, force: true });
  if (cleanupFailures.length)
    throw new AggregateError(
      cleanupFailures,
      `Check disposable Docker project cleanup: ${project}, ${uiProject}`,
    );
}
