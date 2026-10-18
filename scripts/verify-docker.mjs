import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

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
secrets.push(adminKey, apiKey, revokedKey, readOnlyKey);

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
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function ready(url, headers) {
  const deadline = Date.now() + 120_000;
  let last = 'unreachable';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
      last = String(response.status);
      if (response.ok) return;
    } catch {
      /* Container creation and readiness are separate conditions. */
    }
    await sleep(250);
  }
  throw new Error(`Readiness timed out at ${url}: ${last}`);
}

async function api(base, endpoint, { method = 'GET', body, key = apiKey } = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: { 'X-API-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  assert.equal(
    response.status,
    method === 'POST' ? 201 : 200,
    `${method} ${endpoint} returned ${response.status}`,
  );
  return text;
}

let base;
let ui;
let fixture;
let backendConfigured = false;
let uiConfigured = false;
async function browser(phase) {
  console.log(`\nBrowser verification: ${phase}`);
  const selection = {
    foundation:
      'persisted evaluations|policy inspection|authentication, revocation|keys stay in memory',
    playground: 'playground:',
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
    await api(base, '/api/v1/transactions', {
      method: 'POST',
      body: JSON.stringify(event).replace('"__EXACT__"', fixture.precision),
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
  await ready(`${ui}/api/v1/evaluations`, { 'X-API-Key': apiKey });
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
  await browser('balanced');
  console.log(
    '\nDocker UI verification passed: persisted reads, permissions, precision, quotas, dependency recovery, backend DNS recreation and two-instance balancing.',
  );
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
