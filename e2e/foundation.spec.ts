import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const phase = process.env.E2E_PHASE ?? 'foundation';
const key = process.env.E2E_API_KEY ?? '';
const fixture = JSON.parse(process.env.E2E_FIXTURE ?? '{}') as {
  customer: string;
  preciseEvent: string;
  flaggedEvent: string;
  acceptedFrom: string;
  acceptedTo: string;
  precision: string;
};

async function fillKey(input: Locator, credential: string) {
  try {
    await input.fill(credential);
  } catch {
    throw new Error('The API-key field could not be filled. Credential diagnostics are withheld.');
  }
}

async function authenticatedRead(request: APIRequestContext, endpoint: string) {
  try {
    return await request.get(endpoint, { headers: { 'X-API-Key': key } });
  } catch {
    throw new Error(`Authenticated ${endpoint} did not complete. Header diagnostics are withheld.`);
  }
}

async function connect(page: Page, credential = key) {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Fraud Rule Engine — Assessment Demo' }),
  ).toBeVisible();
  await fillKey(page.getByLabel('API key', { exact: true }), credential);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
}

async function preview(page: Page, filename: string) {
  if (process.env.E2E_SCREENSHOTS !== '1') return;
  expect(
    await page
      .locator('input[type="password"]')
      .evaluateAll((inputs) => inputs.every((input) => (input as HTMLInputElement).value === '')),
    'Preview screenshots require empty credential fields',
  ).toBe(true);
  await mkdir('target/preview', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `target/preview/${filename}`,
    fullPage: true,
    animations: 'disabled',
  });
}

test.beforeEach(async ({ page }) => {
  test.skip(!key, 'Run through npm run verify:docker with disposable backend credentials.');
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      expect(request.method(), 'The foundation UI only reads the API').toBe('GET');
      expect(request.url().includes(key), 'Credentials must stay out of URLs').toBe(false);
    }
  });
});

test('persisted evaluations, filters, cursor navigation and exact transaction details', async ({
  page,
}) => {
  test.skip(phase !== 'foundation');
  await connect(page);
  await expect(page.getByRole('heading', { name: 'Evaluations', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'View details', exact: true }).first(),
  ).toBeVisible();
  await preview(page, 'evaluations-desktop.png');
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByLabel('Accepted from', { exact: true }).fill(fixture.acceptedFrom);
  await page.getByLabel('Accepted to', { exact: true }).fill(fixture.acceptedTo);
  await page.getByLabel('Customer ID', { exact: true }).fill(fixture.customer);
  await page.getByLabel('Page size', { exact: true }).fill('1');
  // Delay forwarding, then let the actual Docker API answer; no response is mocked.
  await page.route('**/api/v1/evaluations?**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(/loading/i);
  await expect(page.getByRole('button', { name: 'View details', exact: true })).toHaveCount(1);
  await page.unroute('**/api/v1/evaluations?**');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByText(fixture.preciseEvent, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  const currentAccuracy = page.getByText(/^current accuracy km$/i).locator('..');
  await expect(currentAccuracy.getByText(fixture.precision, { exact: true })).toBeVisible();
  await page.getByText('Submitted location', { exact: true }).click();
  await expect(
    page.locator('.location-facts').getByText(fixture.precision, { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(page.getByText(fixture.preciseEvent, { exact: true })).toHaveCount(0);

  await page.getByLabel('Customer ID', { exact: true }).fill('');
  await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('FLAGGED');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText(fixture.flaggedEvent, { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Decision', exact: true }).selectOption('');
  await page.getByLabel('Customer ID', { exact: true }).fill('no-such-synthetic-customer');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText(/no evaluations/i)).toBeVisible();
});

test('policy inspection and administrator snapshot use read endpoints', async ({ page }) => {
  test.skip(phase !== 'foundation');
  await connect(page);
  await page.getByRole('link', { name: 'Policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Policy', exact: true })).toBeVisible();
  for (const rule of [
    'High amount',
    'Transaction velocity',
    'Cumulative spend',
    'Impossible travel',
    'Small payment burst',
  ]) {
    await expect(page.getByText(rule, { exact: false }).first()).toBeVisible();
  }
  const administrator = process.env.E2E_ADMIN_KEY!;
  const policyUrl = page.url();
  await page.getByRole('link', { name: 'Skip to content', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(policyUrl);
  await expect(page.locator('main')).toBeFocused();
  await page.getByText('Administrator access', { exact: false }).first().click();
  await fillKey(page.getByLabel('Administrator API key', { exact: true }), key);
  await page.getByRole('button', { name: 'Connect administrator', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/permission|forbidden/i);
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/admin/policy',
  );
  await fillKey(page.getByLabel('Administrator API key', { exact: true }), administrator);
  await page.getByRole('button', { name: 'Connect administrator', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(response.headers().etag).toMatch(/^"policy-revision-[1-9]\d*"$/);
  await expect(
    page.getByRole('heading', { name: 'Administrator policy snapshot', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(response.headers().etag, { exact: true })).toBeVisible();
  await page.getByText('Administrator access', { exact: false }).first().click();
  await preview(page, 'policy-desktop.png');
  await expect(page.getByRole('button', { name: 'Validate draft', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate policy', exact: true })).toHaveCount(0);
});

test('authentication, revocation and ordinary credentials cannot read administration', async ({
  page,
  request,
}) => {
  test.skip(phase !== 'foundation');
  const noKey = await request.get('/api/v1/evaluations');
  expect(noKey.status()).toBe(401);
  const forbidden = await authenticatedRead(request, '/api/v1/admin/policy');
  expect(forbidden.status()).toBe(403);
  await connect(page, `local.${'0'.repeat(64)}`);
  await expect(page.getByRole('alert')).toContainText(/key|credential|unauthori[sz]ed|401/i);
  await fillKey(page.getByLabel('API key', { exact: true }), process.env.E2E_REVOKED_KEY!);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/key|credential|unauthori[sz]ed|401/i);
});

test('keys stay in memory, reload clears connection, navigation works on a narrow screen', async ({
  page,
}) => {
  test.skip(phase !== 'foundation');
  const consoleMessages: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  await page.setViewportSize({ width: 390, height: 844 });
  await connect(page);
  await expect(page.getByRole('heading', { name: 'Evaluations', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'View details', exact: true })).toHaveCount(0);
  await fillKey(page.getByLabel('API key', { exact: true }), key);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'View details', exact: true }).first(),
  ).toBeVisible();
  const evaluationLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    outside: Array.from(document.querySelectorAll('*'))
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth)
      .map((element) => ({
        tag: element.tagName,
        class: element.className,
        right: Math.round(element.getBoundingClientRect().right),
      })),
  }));
  expect(
    evaluationLayout.document,
    `Evaluation page overflow: ${JSON.stringify(evaluationLayout)}`,
  ).toBeLessThanOrEqual(evaluationLayout.viewport);
  await preview(page, 'mobile.png');
  await page.getByRole('link', { name: 'Try transactions', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Try transactions', exact: true })).toBeVisible();
  await expect(page.getByLabel('Amount', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
  ).toEqual({ local: {}, session: {} });
  expect(consoleMessages.some((message) => message.includes(key))).toBe(false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
});

test('a real rate limit displays the error without automatic retries', async ({
  page,
  request,
}) => {
  test.skip(phase !== 'rate-limit');
  await connect(page);
  await page.getByRole('link', { name: 'Policy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload policy', exact: true })).toBeVisible();
  await expect(page.getByText('High amount', { exact: true })).toBeVisible();
  let retryAfter: string | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await authenticatedRead(request, '/api/v1/rules');
    if (response.status() === 429) {
      retryAfter = response.headers()['retry-after'];
      break;
    }
    expect(response.status()).toBe(200);
  }
  expect(retryAfter).toMatch(/^\d+$/);
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/rules') requests++;
  });
  let manualRequests = 0;
  let limited = false;
  for (let attempt = 0; attempt < 3 && !limited; attempt++) {
    const responsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/v1/rules',
    );
    await page.getByRole('button', { name: 'Reload policy', exact: true }).click();
    const response = await responsePromise;
    manualRequests++;
    limited = response.status() === 429;
    if (limited) expect(response.headers()['retry-after']).toMatch(/^\d+$/);
    else expect(response.status()).toBe(200);
  }
  expect(limited, 'An explicit manual reload should reach the exhausted policy bucket').toBe(true);
  await expect(page.getByRole('alert')).toContainText(/rate|429/i);
  await expect(page.getByRole('button', { name: 'Reload policy', exact: true })).toBeDisabled();
  await page.waitForTimeout(1_100);
  expect(requests).toBe(manualRequests);
});

test('an unavailable real dependency gives an actionable failure', async ({ page }) => {
  test.skip(phase !== 'dependency-down');
  await connect(page);
  await expect(page.getByRole('alert')).toContainText(/unavailable|503/i);
});

test('dependency recovery and proxy DNS changes keep reads working', async ({ page }) => {
  test.skip(!['recovered', 'recreated', 'balanced'].includes(phase));
  const connection = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/evaluations',
  );
  await connect(page);
  expect((await connection).status(), `${phase}: the connection read must succeed`).toBe(200);
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'View details', exact: true }).first(),
  ).toBeVisible();
  const refresh = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/v1/evaluations',
  );
  await page.getByRole('button', { name: 'Refresh evaluations', exact: true }).click();
  expect((await refresh).status(), `${phase}: a subsequent read must also succeed`).toBe(200);
  await expect(
    page.getByRole('button', { name: 'View details', exact: true }).first(),
  ).toBeVisible();
});
