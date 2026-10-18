import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LosslessNumber, parse, stringify } from 'lossless-json';
import { mkdir } from 'node:fs/promises';
import type { EditablePolicy, PolicyDocument } from '../src/api/client';

const ordinaryKey = process.env.E2E_API_KEY ?? '';
const controlKey = process.env.E2E_ADMIN_KEY ?? '';
const keys = JSON.parse(process.env.E2E_POLICY_KEYS ?? '{}') as Record<string, string>;
const policyPath = '/api/v1/admin/policy';
const validationPath = `${policyPath}/validate`;
const preciseAccuracy = '0.12345678901234567890123456789';
const preciseAllowance = '25.12345678901234567890123456789';

async function fillKey(page: Page, label: string, credential: string) {
  try {
    await page.getByLabel(label, { exact: true }).fill(credential);
  } catch {
    throw new Error('Could not enter the disposable credential; credential diagnostics withheld.');
  }
}

function nextPolicyResponse(page: Page, method: string, path = policyPath) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && new URL(response.url()).pathname === path,
  );
}

async function snapshot(response: Response) {
  expect(response.status()).toBe(200);
  const etag = response.headers().etag!;
  expect(etag).toMatch(/^"policy-revision-[1-9]\d*"$/);
  return { data: parse(await response.text()) as EditablePolicy, etag };
}

async function ordinaryConnection(page: Page) {
  await page.goto('/#policy');
  await fillKey(page, 'API key', ordinaryKey);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await page.getByText('Administrator access', { exact: false }).first().click();
}

async function administratorConnection(page: Page, name: string) {
  await ordinaryConnection(page);
  await fillKey(page, 'Administrator API key', keys[name]!);
  const current = nextPolicyResponse(page, 'GET');
  await page.getByRole('button', { name: 'Connect administrator', exact: true }).click();
  const initial = await snapshot(await current);
  await expect(page.getByTestId('policy-editor')).toBeVisible();
  await expect(page.getByLabel('High amount threshold (ZAR)', { exact: true })).toBeVisible();
  return initial;
}

async function jsonDraft(page: Page) {
  const editor = page.getByTestId('policy-editor');
  const json = editor.getByRole('textbox', { name: 'Policy JSON', exact: true });
  if (!(await json.isVisible())) {
    await editor.getByText('Advanced policy JSON', { exact: true }).click();
  }
  await expect(json).toBeVisible();
  return json;
}

async function validateAndReview(page: Page) {
  const validation = nextPolicyResponse(page, 'POST', validationPath);
  await page.getByRole('button', { name: 'Validate draft', exact: true }).click();
  const response = await validation;
  expect(response.status()).toBe(200);
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review changes', exact: true })).toBeVisible();
  return response;
}

function observeWrites(page: Page) {
  const writes: Array<{ method: string; raw: string; ifMatch?: string }> = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' || (path !== policyPath && path !== validationPath)) return;
    writes.push({
      method: request.method(),
      raw: request.postData() ?? '',
      ifMatch: request.headers()['if-match'],
    });
  });
  return writes;
}

async function policyRequest(
  request: APIRequestContext,
  {
    credential = controlKey,
    method = 'GET',
    body,
    etag,
  }: {
    credential?: string;
    method?: string;
    body?: string;
    etag?: string;
  } = {},
) {
  try {
    return await request.fetch(policyPath, {
      method,
      headers: {
        'X-API-Key': credential,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(etag ? { 'If-Match': etag } : {}),
      },
      ...(body ? { data: body } : {}),
      maxRetries: 0,
      maxRedirects: 0,
    });
  } catch {
    throw new Error('Policy request did not complete; credential header diagnostics withheld.');
  }
}

function increaseWholeAmount(value: string) {
  const [whole, fraction] = value.split('.');
  return `${BigInt(whole!) + 1n}${fraction === undefined ? '' : `.${fraction}`}`;
}

async function accessible(page: Page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
}

async function preview(page: Page, filename: string) {
  if (process.env.E2E_SCREENSHOTS !== '1') return;
  expect(
    await page
      .locator('input[type="password"]')
      .evaluateAll((inputs) => inputs.every((input) => (input as HTMLInputElement).value === '')),
  ).toBe(true);
  await mkdir('target/preview', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `target/preview/${filename}`,
    fullPage: true,
    animations: 'disabled',
  });
}

test.beforeEach(() => {
  test.skip(
    process.env.E2E_PHASE !== 'policy' || !ordinaryKey || !keys.forms,
    'Run through the isolated Docker verification harness.',
  );
});

test('policy: forms and exact JSON share one draft across all five rules, currencies and timing', async ({
  page,
}) => {
  const writes = observeWrites(page);
  await administratorConnection(page, 'forms');
  for (const name of [
    'High amount',
    'Transaction velocity',
    'Cumulative spend',
    'Impossible travel',
    'Small payment burst',
  ]) {
    const toggle = page.getByLabel(`${name} enabled`, { exact: true });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await toggle.check();
  }
  for (const name of [
    'Velocity window (seconds)',
    'Cumulative threshold (ZAR)',
    'Travel maximum comparison age (seconds)',
    'Travel maximum candidates',
    'Travel maximum speed (km/h)',
    'Travel minimum distance (km)',
    'Burst window (seconds)',
    'Small payment maximum (ZAR)',
    'Large payment threshold (ZAR)',
  ]) {
    await expect(page.getByLabel(name, { exact: true })).toBeVisible();
  }
  for (const name of [
    'Trusted ATM terminals',
    'Trusted card terminals',
    'Eligible ATM transactions',
    'Eligible card-present transactions',
  ]) {
    const toggle = page.getByLabel(name, { exact: true });
    await toggle.uncheck();
    await toggle.check();
  }
  for (const name of [
    'Velocity maximum transactions',
    'Cumulative window (seconds)',
    'Burst minimum small payments',
    'Maximum event age (seconds)',
    'Maximum future skew (seconds)',
  ]) {
    const input = page.getByLabel(name, { exact: true });
    await input.fill((BigInt(await input.inputValue()) + 1n).toString());
  }
  const threshold = page.getByLabel('High amount threshold (ZAR)', { exact: true });
  const newThreshold = increaseWholeAmount(await threshold.inputValue());
  await threshold.fill(newThreshold);
  const scale = page.getByLabel('Currency ZAR scale', { exact: true });
  const newScale = '4';
  await scale.fill(newScale);
  const maximum = page.getByLabel('Currency ZAR maximum amount', { exact: true });
  const newMaximum = '9007199254740993.9999';
  await maximum.fill(newMaximum);
  await page.getByLabel('Travel maximum accuracy (km)', { exact: true }).fill(preciseAccuracy);
  const json = await jsonDraft(page);
  const candidate = parse(await json.inputValue()) as PolicyDocument;
  expect(candidate.rules.highAmount.thresholds.ZAR).toBe(newThreshold);
  expect(candidate.supportedCurrencies.ZAR!.scale.toString()).toBe(newScale);
  expect(candidate.supportedCurrencies.ZAR!.maxAmount).toBe(newMaximum);
  expect(candidate.rules.impossibleTravel.maxAccuracyKm.toString()).toBe(preciseAccuracy);
  candidate.rules.impossibleTravel.travelAllowanceKm = new LosslessNumber(preciseAllowance);
  await json.fill(stringify(candidate)!);
  await expect(page.getByLabel('Travel allowance (km)', { exact: true })).toHaveValue(
    preciseAllowance,
  );
  expect(writes).toHaveLength(0);
  await accessible(page);
  await preview(page, 'policy-editor-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await accessible(page);
  await preview(page, 'policy-editor-mobile.png');
  await page.setViewportSize({ width: 1280, height: 720 });
  const validation = await validateAndReview(page);
  expect(validation.request().postData()).toContain(preciseAccuracy);
  expect(validation.request().postData()).toContain(preciseAllowance);
  expect(validation.request().postData()).toContain(newMaximum);
  expect(writes.filter((write) => write.method === 'PUT')).toHaveLength(0);
  await accessible(page);
  await preview(page, 'policy-review-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await accessible(page);
  await preview(page, 'policy-review-mobile.png');
  await page.setViewportSize({ width: 1280, height: 720 });
  const activation = nextPolicyResponse(page, 'PUT');
  await page.getByRole('button', { name: 'Activate policy', exact: true }).click();
  const activationResponse = await activation;
  expect(activationResponse.request().postData()).toContain(preciseAccuracy);
  expect(activationResponse.request().postData()).toContain(preciseAllowance);
  const active = await snapshot(activationResponse);
  await expect(page.getByTestId('policy-editor')).toContainText('Policy activated.');
  const activeAccuracy = active.data.document.rules.impossibleTravel.maxAccuracyKm.toString();
  const activeAllowance = active.data.document.rules.impossibleTravel.travelAllowanceKm.toString();
  // Travel numbers are normalized by the backend; the UI must show its actual response.
  await expect(page.getByLabel('Travel maximum accuracy (km)', { exact: true })).toHaveValue(
    activeAccuracy,
  );
  await expect(page.getByLabel('Travel allowance (km)', { exact: true })).toHaveValue(
    activeAllowance,
  );
  expect(active.data.document.supportedCurrencies.ZAR!.maxAmount).toBe(newMaximum);
  await expect(maximum).toHaveValue(newMaximum);
  const readCurrent = nextPolicyResponse(page, 'GET');
  await page.getByRole('button', { name: 'Read current policy', exact: true }).click();
  const stored = await snapshot(await readCurrent);
  expect(stored.etag).toBe(active.etag);
  expect(stored.data.document.rules.impossibleTravel.maxAccuracyKm.toString()).toBe(activeAccuracy);
  expect(stored.data.document.rules.impossibleTravel.travelAllowanceKm.toString()).toBe(
    activeAllowance,
  );
  expect(stored.data.document.supportedCurrencies.ZAR!.maxAmount).toBe(newMaximum);
  expect(writes.filter((write) => write.method === 'PUT')).toHaveLength(1);
});

test('policy: invalid business values return real validation errors without activation', async ({
  page,
}) => {
  const writes = observeWrites(page);
  const initial = await administratorConnection(page, 'invalid');
  await page.getByLabel('Travel maximum candidates', { exact: true }).fill('0');
  const validation = nextPolicyResponse(page, 'POST', validationPath);
  await page.getByRole('button', { name: 'Validate draft', exact: true }).click();
  expect((await validation).status()).toBe(422);
  await expect(page.getByTestId('policy-editor').getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Travel maximum candidates', { exact: true })).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Activate policy', exact: true })).toHaveCount(0);
  expect(writes.filter((write) => write.method === 'PUT')).toHaveLength(0);
  const current = await policyRequest(page.request, { credential: keys.invalid });
  expect(current.status()).toBe(200);
  expect(current.headers().etag).toBe(initial.etag);
  expect((parse(await current.text()) as EditablePolicy).policyHash).toBe(initial.data.policyHash);
});

test('policy: activating an unchanged validated document preserves its exact revision', async ({
  page,
}) => {
  const writes = observeWrites(page);
  const initial = await administratorConnection(page, 'unchanged');
  const validation = await validateAndReview(page);
  expect((parse(await validation.text()) as { policyHash: string }).policyHash).toBe(
    initial.data.policyHash,
  );
  const activation = nextPolicyResponse(page, 'PUT');
  await page.getByRole('button', { name: 'Activate policy', exact: true }).click();
  const active = await snapshot(await activation);
  expect(active.etag).toBe(initial.etag);
  expect(active.data.revision.toString()).toBe(initial.data.revision.toString());
  await expect(page.getByTestId('policy-editor')).toContainText(
    'Policy unchanged; revision preserved.',
  );
  expect(writes.filter((write) => write.method === 'PUT')).toHaveLength(1);
  expect(writes.find((write) => write.method === 'PUT')!.ifMatch).toBe(initial.etag);
});

test('policy: a concurrent activation returns 412 and keeps the local draft for explicit review', async ({
  page,
  request,
}) => {
  const writes = observeWrites(page);
  const initial = await administratorConnection(page, 'concurrent');
  const threshold = page.getByLabel('High amount threshold (ZAR)', { exact: true });
  await threshold.fill(increaseWholeAmount(await threshold.inputValue()));
  const retained = await (await jsonDraft(page)).inputValue();
  await validateAndReview(page);
  const competing = parse(stringify(initial.data.document)!) as PolicyDocument;
  competing.rules.highAmount.thresholds.ZAR = increaseWholeAmount(
    increaseWholeAmount(initial.data.document.rules.highAmount.thresholds.ZAR!),
  );
  const winner = await policyRequest(request, {
    method: 'PUT',
    body: stringify(competing)!,
    etag: initial.etag,
  });
  expect(winner.status()).toBe(200);
  const activation = nextPolicyResponse(page, 'PUT');
  await page.getByRole('button', { name: 'Activate policy', exact: true }).click();
  expect((await activation).status()).toBe(412);
  await expect(
    page
      .getByTestId('policy-editor')
      .getByText(/The active revision changed\. Your draft is kept\./),
  ).toBeVisible();
  expect(await (await jsonDraft(page)).inputValue()).toBe(retained);
  const current = nextPolicyResponse(page, 'GET');
  await page.getByRole('button', { name: 'Read current policy', exact: true }).click();
  const fresh = await snapshot(await current);
  expect(fresh.etag).toBe(winner.headers().etag);
  expect(await (await jsonDraft(page)).inputValue()).toBe(retained);
  await expect(page.getByRole('button', { name: 'Activate policy', exact: true })).toHaveCount(0);
  expect(writes.filter((write) => write.method === 'PUT')).toHaveLength(1);
});

test('policy: a committed activation with a lost response waits for an explicit current-policy read', async ({
  page,
}) => {
  const writes = observeWrites(page);
  await administratorConnection(page, 'unknown');
  const threshold = page.getByLabel('High amount threshold (ZAR)', { exact: true });
  await threshold.fill(increaseWholeAmount(await threshold.inputValue()));
  const retained = await (await jsonDraft(page)).inputValue();
  await validateAndReview(page);
  let committed: EditablePolicy | undefined;
  await page.route(`**${policyPath}`, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
      expect(response.status()).toBe(200);
      committed = parse(await response.text()) as EditablePolicy;
    } catch {
      await route.abort('failed');
      throw new Error('Could not forward the real activation; credential diagnostics withheld.');
    }
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Activate policy', exact: true }).click();
  await expect(page.getByTestId('policy-editor')).toContainText('Activation outcome unknown.');
  expect(committed).toBeDefined();
  await page.waitForTimeout(1_100);
  expect(writes.filter((write) => write.method === 'PUT')).toHaveLength(1);
  expect(await (await jsonDraft(page)).inputValue()).toBe(retained);
  const current = nextPolicyResponse(page, 'GET');
  await page.getByRole('button', { name: 'Read current policy', exact: true }).click();
  const active = await snapshot(await current);
  expect(active.data.policyHash).toBe(committed!.policyHash);
  await expect(page.getByTestId('policy-editor')).toContainText(
    'Current policy matches the attempted candidate.',
  );
  await expect(page.getByRole('button', { name: 'Activate policy', exact: true })).toHaveCount(0);
  expect(writes.filter((write) => write.method === 'PUT')).toHaveLength(1);
});

test('policy: permissions, revoked credentials, revision preconditions and disconnect protect the editor', async ({
  page,
  request,
}) => {
  const consoleMessages: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  const writes = observeWrites(page);
  await ordinaryConnection(page);
  await expect(page.getByTestId('policy-editor')).toHaveCount(0);
  await fillKey(page, 'Administrator API key', ordinaryKey);
  await page.getByRole('button', { name: 'Connect administrator', exact: true }).click();
  await expect(page.locator('.admin-connection').getByRole('alert')).toContainText(
    /permission|forbidden/i,
  );
  await fillKey(page, 'Administrator API key', process.env.E2E_REVOKED_KEY!);
  await page.getByRole('button', { name: 'Connect administrator', exact: true }).click();
  await expect(page.locator('.admin-connection').getByRole('alert')).toContainText(
    /key|credential|unauthori[sz]ed/i,
  );
  await fillKey(page, 'Administrator API key', keys.permissions!);
  const current = nextPolicyResponse(page, 'GET');
  await page.getByRole('button', { name: 'Connect administrator', exact: true }).click();
  const initial = await snapshot(await current);
  const threshold = page.getByLabel('High amount threshold (ZAR)', { exact: true });
  await expect(threshold).toBeVisible();
  const original = await threshold.inputValue();
  await threshold.fill(increaseWholeAmount(original));
  const missingRevision = await policyRequest(request, {
    credential: keys.permissions,
    method: 'PUT',
    body: stringify(initial.data.document)!,
  });
  expect(missingRevision.status()).toBe(428);
  await page.getByRole('button', { name: 'Disconnect administrator', exact: true }).click();
  await expect(page.getByTestId('policy-editor')).toHaveCount(0);
  await expect(page.getByLabel('Administrator API key', { exact: true })).toHaveValue('');
  await fillKey(page, 'Administrator API key', keys.permissions!);
  await page.getByRole('button', { name: 'Connect administrator', exact: true }).click();
  await expect(threshold).toHaveValue(original);
  expect(writes).toHaveLength(0);
  expect(
    await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
  ).toEqual({ local: {}, session: {} });
  for (const credential of [ordinaryKey, keys.permissions!, process.env.E2E_REVOKED_KEY!]) {
    expect(page.url().includes(credential)).toBe(false);
    expect(consoleMessages.some((message) => message.includes(credential))).toBe(false);
  }
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByTestId('policy-editor')).toHaveCount(0);
});

test('policy: the shared administrator quota respects Retry-After without automatic validation or activation', async ({
  page,
  request,
}) => {
  const writes = observeWrites(page);
  await administratorConnection(page, 'rate');
  let retryAfter: string | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await policyRequest(request, { credential: keys.rate });
    if (response.status() === 429) {
      retryAfter = response.headers()['retry-after'];
      break;
    }
    expect(response.status()).toBe(200);
  }
  expect(retryAfter).toMatch(/^\d+$/);
  let limited = false;
  let manualValidations = 0;
  for (let attempt = 0; attempt < 3 && !limited; attempt++) {
    const validation = nextPolicyResponse(page, 'POST', validationPath);
    await page.getByRole('button', { name: 'Validate draft', exact: true }).click();
    const response = await validation;
    manualValidations++;
    limited = response.status() === 429;
    if (limited) expect(response.headers()['retry-after']).toMatch(/^\d+$/);
    else expect(response.status()).toBe(200);
  }
  expect(limited).toBe(true);
  await expect(page.getByTestId('policy-editor').getByRole('alert')).toContainText(
    /limit|rate|429/i,
  );
  await expect(page.getByRole('button', { name: 'Validate draft', exact: true })).toBeDisabled();
  await page.waitForTimeout(1_100);
  expect(writes.filter((write) => write.method === 'POST')).toHaveLength(manualValidations);
  expect(writes.filter((write) => write.method === 'PUT')).toHaveLength(0);
});
