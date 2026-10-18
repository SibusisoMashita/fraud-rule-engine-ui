import { expect, test, type Page, type Request, type Response } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

const key = process.env.E2E_API_KEY ?? '';
const transactionPath = '/api/v1/transactions';
const precision = '0.12345678901234567890123456789';

interface Identity {
  eventId: string;
  customerId: string;
  instrumentId: string;
}

interface Post {
  request: Request;
  identity: Identity;
  response?: Response;
}

function isSubmission(request: Request) {
  return request.method() === 'POST' && new URL(request.url()).pathname === transactionPath;
}

function observeSubmissions(page: Page) {
  const posts: Post[] = [];
  const pending = new Set<Request>();
  let maximumPending = 0;
  page.on('request', (request) => {
    if (!isSubmission(request)) return;
    pending.add(request);
    maximumPending = Math.max(maximumPending, pending.size);
    // Only identity strings are read through this parser; decimal checks use the raw wire text.
    const { eventId, customerId, instrumentId } = JSON.parse(request.postData()!) as Identity;
    posts.push({ request, identity: { eventId, customerId, instrumentId } });
  });
  page.on('response', (response) => {
    const request = response.request();
    if (!isSubmission(request)) return;
    pending.delete(request);
    posts.find((post) => post.request === request)!.response = response;
  });
  page.on('requestfailed', (request) => pending.delete(request));
  return { posts, maximumPending: () => maximumPending };
}

async function enterCredential(page: Page, credential: string) {
  try {
    await page.getByLabel('API key', { exact: true }).fill(credential);
  } catch {
    throw new Error('Could not enter the disposable credential; credential diagnostics withheld.');
  }
}

async function connect(page: Page, credential = key) {
  await page.goto('/');
  await enterCredential(page, credential);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  const currencies = page.waitForResponse(isCurrencyRead);
  await page.getByRole('link', { name: 'Try transactions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Try transactions', exact: true })).toBeVisible();
  await readyCurrencies(page, await currencies);
}

function isCurrencyRead(response: Response) {
  return (
    response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/v1/rules'
  );
}

async function readyCurrencies(page: Page, response: Response) {
  if (response.status() === 429) {
    // Independent fast tests share a real quota. Exercise the explicit UI recovery action.
    await expect(page.getByRole('alert').filter({ hasText: 'RATE_LIMITED' })).toBeVisible();
    const reload = page.getByRole('button', { name: 'Reload currencies', exact: true });
    await expect(reload).toBeEnabled();
    const nextRead = page.waitForResponse(isCurrencyRead);
    await reload.click();
    response = await nextRead;
  }
  expect(
    response.status(),
    'Active currencies must be available before a transaction workflow',
  ).toBe(200);
  await expect(page.getByRole('combobox', { name: 'Currency', exact: true })).toBeEnabled();
}

function nextSubmission(page: Page) {
  return page.waitForResponse((response) => isSubmission(response.request()));
}

async function newTransaction(page: Page) {
  await page.getByRole('button', { name: 'New transaction', exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill('100.10');
}

async function submitFixture(page: Page, raw: string) {
  try {
    return await page.request.post(transactionPath, {
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      data: raw,
      maxRetries: 0,
      maxRedirects: 0,
    });
  } catch {
    throw new Error('The real fixture submission failed; credential diagnostics withheld.');
  }
}

async function submitted(page: Page, response: Response, status: number) {
  expect(response.status()).toBe(status);
  await expect(
    page.getByTestId('transaction-result').getByRole('heading', { name: 'Saved', exact: true }),
  ).toBeVisible();
  return response.text();
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

test.beforeEach(() => {
  test.skip(
    process.env.E2E_PHASE !== 'playground' || !key,
    'Run through the isolated Docker verification harness.',
  );
});

for (const scenario of [
  { name: 'High amount', rule: 'HIGH_AMOUNT' },
  { name: 'Transaction velocity', rule: 'TRANSACTION_VELOCITY' },
  { name: 'Cumulative spend', rule: 'CUMULATIVE_SPEND' },
  { name: 'Impossible travel', rule: 'IMPOSSIBLE_TRAVEL' },
  { name: 'Small payment burst', rule: 'SMALL_PAYMENT_BURST_THEN_LARGE' },
]) {
  test(`playground: ${scenario.name} uses sequential real transactions and persisted rule outcomes`, async ({
    page,
  }) => {
    const observed = observeSubmissions(page);
    await connect(page);
    await page.getByRole('button', { name: scenario.name, exact: true }).click();
    if (scenario.rule === 'TRANSACTION_VELOCITY') {
      await expect(page.getByRole('button', { name: /^Edit transaction 1\b/ })).toBeVisible();
      await accessible(page);
    }
    expect(observed.posts).toHaveLength(0);
    await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
    await expect(page.getByRole('button', { name: 'New scenario run', exact: true })).toBeVisible();
    expect(observed.posts.length).toBeGreaterThan(0);
    expect(observed.maximumPending(), 'History events must complete sequentially').toBe(1);
    for (const post of observed.posts) expect(post.response?.status()).toBe(201);
    const final = JSON.parse(await observed.posts.at(-1)!.response!.text()) as {
      evaluation: { decision: string; ruleResults: Array<{ ruleId: string; status: string }> };
    };
    expect(final.evaluation.decision).toBe('FLAGGED');
    expect(final.evaluation.ruleResults.find((rule) => rule.ruleId === scenario.rule)?.status).toBe(
      'MATCH',
    );
    await expect(page.getByTestId('transaction-result')).toContainText(/flagged/i);
    const firstRun = observed.posts.map((post) => post.identity);
    expect(new Set(firstRun.map((event) => event.eventId)).size).toBe(firstRun.length);
    expect(new Set(firstRun.map((event) => event.customerId)).size).toBe(1);
    expect(new Set(firstRun.map((event) => event.instrumentId)).size).toBe(1);

    if (scenario.rule === 'TRANSACTION_VELOCITY') {
      expect(firstRun.length).toBeGreaterThan(1);
      await page.getByRole('button', { name: 'New scenario run', exact: true }).click();
      expect(observed.posts).toHaveLength(firstRun.length);
      await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'New scenario run', exact: true }),
      ).toBeVisible();
      const secondRun = observed.posts.slice(firstRun.length).map((post) => post.identity);
      expect(secondRun).toHaveLength(firstRun.length);
      expect(
        secondRun.some((event) => firstRun.some((previous) => previous.eventId === event.eventId)),
      ).toBe(false);
      expect(secondRun[0]!.customerId).not.toBe(firstRun[0]!.customerId);
      expect(secondRun[0]!.instrumentId).not.toBe(firstRun[0]!.instrumentId);
      expect(observed.maximumPending()).toBe(1);
    }
  });
}

test('playground: editing an example changes the actual backend outcome without automatic submission', async ({
  page,
}) => {
  const observed = observeSubmissions(page);
  await connect(page);
  await page.getByRole('button', { name: 'High amount', exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill('1.00');
  expect(observed.posts).toHaveLength(0);
  const responsePromise = nextSubmission(page);
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  const body = await submitted(page, await responsePromise, 201);
  const result = JSON.parse(body) as {
    evaluation: {
      decision: 'CLEAR' | 'FLAGGED' | 'INDETERMINATE';
      ruleResults: Array<{ ruleId: string; status: string }>;
    };
  };
  expect(result.evaluation.ruleResults.find((rule) => rule.ruleId === 'HIGH_AMOUNT')?.status).toBe(
    'NO_MATCH',
  );
  const visibleResult = page.getByTestId('transaction-result');
  const highAmount = visibleResult.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'High amount', exact: true }),
  });
  await expect(highAmount.getByText('No match', { exact: true })).toBeVisible();
  const decisionLabels = { CLEAR: 'Clear', FLAGGED: 'Flagged', INDETERMINATE: 'Indeterminate' };
  await expect(
    visibleResult
      .locator('.decision-strip')
      .getByText(decisionLabels[result.evaluation.decision], { exact: true }),
  ).toBeVisible();
  expect(observed.posts).toHaveLength(1);
});

test('playground: a draft prepared before connecting keeps its edited scenario and submitted payload', async ({
  page,
}) => {
  const observed = observeSubmissions(page);
  await page.goto('/#transactions');
  const preset = page.getByRole('button', { name: 'Impossible travel', exact: true });
  await preset.click();
  const eventId = await page.getByLabel('Event ID', { exact: true }).inputValue();
  await page.getByLabel('Amount', { exact: true }).fill('12.34');
  const customerId = await page.getByLabel('Customer ID', { exact: true }).inputValue();
  const instrumentId = await page.getByLabel('Instrument ID', { exact: true }).inputValue();
  expect(observed.posts).toHaveLength(0);

  await enterCredential(page, key);
  const currencies = page.waitForResponse(isCurrencyRead);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await readyCurrencies(page, await currencies);
  await expect(preset).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('group', { name: 'Scenario transactions' }).getByRole('button'),
  ).toHaveCount(2);
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('12.34');
  await expect(page.getByLabel('Event ID', { exact: true })).toHaveValue(eventId);
  await expect(page.getByLabel('Customer ID', { exact: true })).toHaveValue(customerId);
  await expect(page.getByLabel('Instrument ID', { exact: true })).toHaveValue(instrumentId);
  expect(observed.posts).toHaveLength(0);

  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New scenario run', exact: true })).toBeVisible();
  expect(observed.posts).toHaveLength(2);
  expect(observed.maximumPending()).toBe(1);
  for (const post of observed.posts) expect(post.response?.status()).toBe(201);
  expect(observed.posts[0]!.identity).toEqual({ eventId, customerId, instrumentId });
  expect((JSON.parse(observed.posts[0]!.request.postData()!) as { amount: string }).amount).toBe(
    '12.34',
  );
  const final = JSON.parse(await observed.posts[1]!.response!.text()) as {
    evaluation: { ruleResults: Array<{ ruleId: string; status: string }> };
  };
  expect(
    final.evaluation.ruleResults.find((rule) => rule.ruleId === 'IMPOSSIBLE_TRAVEL')?.status,
  ).toBe('MATCH');
});

test('playground: an instrument ownership conflict explains the customer mismatch without claiming a fresh event already exists', async ({
  page,
}) => {
  const observed = observeSubmissions(page);
  await connect(page);
  await newTransaction(page);
  const freshEventId = await page.getByLabel('Event ID', { exact: true }).inputValue();
  const newCustomerId = await page.getByLabel('Customer ID', { exact: true }).inputValue();
  const instrumentId = await page.getByLabel('Instrument ID', { exact: true }).inputValue();
  // The simplified form owns its IDs. Establish another owner through the actual API.
  const accepted = await submitFixture(
    page,
    JSON.stringify({
      eventId: `ui-owner-${crypto.randomUUID()}`,
      customerId: `ui-owner-customer-${crypto.randomUUID()}`,
      instrumentId,
      transactionType: 'CARD_PURCHASE',
      status: 'BOOKED',
      channel: 'ECOMMERCE',
      amount: '100.10',
      currency: 'ZAR',
      category: 'GROCERIES',
      occurredAt: new Date().toISOString(),
    }),
  );
  expect(accepted.status()).toBe(201);
  const rejected = nextSubmission(page);
  await page.getByRole('button', { name: 'Submit transaction', exact: true }).click();
  const response = await rejected;
  expect(response.status()).toBe(409);
  expect(await response.text()).toContain('INSTRUMENT_OWNER_CONFLICT');
  const result = page.getByTestId('transaction-result');
  await expect(result.getByRole('heading', { name: 'Rejected', exact: true })).toBeVisible();
  const message = result.getByRole('alert').locator('strong');
  await expect(message).toContainText(/instrument/i);
  await expect(message).toContainText(/customer/i);
  await expect(message).not.toContainText(/event ID/i);

  const savedPath = `${transactionPath}/${encodeURIComponent(freshEventId)}`;
  const retrieval = page.waitForResponse(
    (saved) => saved.request().method() === 'GET' && new URL(saved.url()).pathname === savedPath,
  );
  await page.getByRole('button', { name: 'Retrieve saved result', exact: true }).click();
  expect((await retrieval).status()).toBe(404);
  await expect(result.getByRole('heading', { name: 'Rejected', exact: true })).toBeVisible();
  await expect(result.getByRole('heading', { name: 'Outcome unknown', exact: true })).toHaveCount(
    0,
  );
  expect(observed.posts).toHaveLength(1);
  expect(observed.posts[0]!.identity).toEqual({
    eventId: freshEventId,
    customerId: newCustomerId,
    instrumentId,
  });
});

test('playground: exact decimals, identical replay, retrieval and a conflicting duplicate use the real API', async ({
  page,
}) => {
  const observed = observeSubmissions(page);
  await connect(page);
  await newTransaction(page);
  await page.getByRole('combobox', { name: 'Channel', exact: true }).selectOption('CARD_PRESENT');
  await page.getByLabel('Include physical location', { exact: true }).check();
  await page
    .getByRole('combobox', { name: 'Demo location', exact: true })
    .selectOption('cape-town');
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('-33.9249');
  await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue('18.4241');
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('Cape Town');
  const accuracy = await page.getByLabel('Accuracy (km)', { exact: true }).inputValue();
  await accessible(page);
  let responsePromise = nextSubmission(page);
  await page.getByRole('button', { name: 'Submit transaction', exact: true }).click();
  const originalResponse = await responsePromise;
  const originalBody = await submitted(page, originalResponse, 201);
  const originalPayload = observed.posts[0]!.request.postData()!;
  expect(originalPayload).toContain(`"accuracyKm":${accuracy}`);
  expect(originalBody.match(/"accuracyKm"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1]).toBe(accuracy);
  expect((JSON.parse(originalPayload) as { amount: string }).amount).toBe('100.10');
  await accessible(page);
  await preview(page, 'playground-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await accessible(page);
  await preview(page, 'playground-mobile.png');
  await page.setViewportSize({ width: 1280, height: 720 });

  responsePromise = nextSubmission(page);
  await page.getByRole('button', { name: 'Replay identical payload', exact: true }).click();
  expect(await submitted(page, await responsePromise, 200)).toBe(originalBody);
  expect(observed.posts[1]!.request.postData()).toBe(originalPayload);

  const savedPath = `${transactionPath}/${encodeURIComponent(observed.posts[0]!.identity.eventId)}`;
  const retrieval = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === savedPath,
  );
  await page.getByRole('button', { name: 'Retrieve saved result', exact: true }).click();
  const saved = await retrieval;
  expect(saved.status()).toBe(200);
  expect(await saved.text()).toBe(originalBody);

  await page.getByLabel('Conflicting amount', { exact: true }).fill('100.11');
  responsePromise = nextSubmission(page);
  await page.getByRole('button', { name: 'Conflicting duplicate', exact: true }).click();
  expect((await responsePromise).status()).toBe(409);
  await expect(page.getByTestId('transaction-result')).toContainText(/conflict|rejected|409/i);
  expect(observed.posts).toHaveLength(3);
  expect(observed.posts[2]!.identity.eventId).toBe(observed.posts[0]!.identity.eventId);
  expect((JSON.parse(observed.posts[2]!.request.postData()!) as { amount: string }).amount).toBe(
    '100.11',
  );
});

test('playground: generated fields and policy currencies keep a manual ATM keyboard submission consistent', async ({
  page,
}) => {
  const observed = observeSubmissions(page);
  await connect(page);
  await newTransaction(page);
  for (const label of ['Event ID', 'Customer ID', 'Instrument ID', 'Occurred at']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('readonly', '');
  }
  const currency = page.getByRole('combobox', { name: 'Currency', exact: true });
  await expect(currency.locator('option[value="ZAR"]')).toHaveCount(1);
  const amount = page.getByLabel('Amount', { exact: true });
  await amount.fill('not-a-number');
  await expect(amount).not.toHaveValue(/[A-Za-z]/);
  await amount.fill('100.10');
  await page
    .getByRole('combobox', { name: 'Transaction type', exact: true })
    .selectOption('ATM_WITHDRAWAL');
  await expect(page.getByRole('combobox', { name: 'Channel', exact: true })).toHaveValue('ATM');
  await page.getByLabel('Include physical location', { exact: true }).check();
  await page
    .getByRole('combobox', { name: 'Demo location', exact: true })
    .selectOption('johannesburg');
  for (const label of ['Latitude', 'Longitude', 'Accuracy (km)', 'City', 'Location source']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('readonly', '');
  }
  await expect(page.getByLabel('City', { exact: true })).toHaveValue('Johannesburg');
  await expect(page.getByLabel('Location source', { exact: true })).toHaveValue(
    'VERIFIED_ATM_TERMINAL',
  );
  await amount.fill('.50');
  const response = nextSubmission(page);
  await amount.press('Enter');
  await submitted(page, await response, 201);
  expect(observed.posts).toHaveLength(1);
  expect(JSON.parse(observed.posts[0]!.request.postData()!)).toMatchObject({
    transactionType: 'ATM_WITHDRAWAL',
    channel: 'ATM',
    amount: '0.50',
    currency: 'ZAR',
    physicalLocation: {
      latitude: -26.2041,
      longitude: 28.0473,
      source: 'VERIFIED_ATM_TERMINAL',
      city: 'Johannesburg',
    },
  });
});

test('playground: precise external location evidence survives replay and renders exactly in saved details', async ({
  page,
}) => {
  await connect(page);
  const customerId = `ui-precision-customer-${crypto.randomUUID()}`;
  const eventId = `ui-precision-event-${crypto.randomUUID()}`;
  const raw = JSON.stringify({
    eventId,
    customerId,
    instrumentId: `ui-precision-card-${crypto.randomUUID()}`,
    transactionType: 'CARD_PURCHASE',
    status: 'BOOKED',
    channel: 'CARD_PRESENT',
    amount: '100.10',
    currency: 'ZAR',
    category: 'GROCERIES',
    occurredAt: new Date().toISOString(),
    physicalLocation: {
      latitude: -33.9249,
      longitude: 18.4241,
      accuracyKm: precision,
      source: 'VERIFIED_CARD_PRESENT_TERMINAL',
      city: 'Cape Town',
    },
  }).replace(`"${precision}"`, precision);
  // Deliberately bypass the sample-location form, not the service: external events may be more precise.
  expect(raw).toContain(`"accuracyKm":${precision}`);
  const created = await submitFixture(page, raw);
  expect(created.status()).toBe(201);
  const original = await created.text();
  expect(original.match(/"accuracyKm"\s*:\s*([0-9]+(?:\.[0-9]+)?)/)?.[1]).toBe(precision);
  const replayed = await submitFixture(page, raw);
  expect(replayed.status()).toBe(200);
  expect(await replayed.text()).toBe(original);

  await page.getByRole('link', { name: 'Evaluations', exact: true }).click();
  await page.getByLabel('Customer ID', { exact: true }).fill(customerId);
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText(eventId, { exact: true })).toBeVisible();
  const lookup = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `${transactionPath}/${eventId}`,
  );
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  expect(await (await lookup).text()).toBe(original);
  const details = page.getByTestId('evaluation-details');
  await details.getByText('Submitted location', { exact: true }).click();
  await expect(
    details.locator('.location-facts').getByText(precision, { exact: true }),
  ).toBeVisible();
  await details.getByText('Raw API response', { exact: true }).click();
  await expect(details.getByLabel('Raw API response', { exact: true })).toContainText(precision);
});

test('playground: a committed transaction with a lost response stays unknown until explicit identical replay', async ({
  page,
}) => {
  const observed = observeSubmissions(page);
  await connect(page);
  await page.getByRole('button', { name: 'Transaction velocity', exact: true }).click();
  let committedBody = '';
  let routedPosts = 0;
  await page.route(`**${transactionPath}`, async (route) => {
    if (!isSubmission(route.request())) {
      await route.continue();
      return;
    }
    routedPosts++;
    if (routedPosts !== 2) {
      await route.continue();
      return;
    }
    let committedStatus;
    try {
      const committed = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
      committedStatus = committed.status();
      committedBody = await committed.text();
    } catch {
      await route.abort('failed');
      throw new Error(
        'Could not forward the real transaction; credential header diagnostics withheld.',
      );
    }
    expect(committedStatus).toBe(201);
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(page.getByTestId('transaction-result')).toContainText('Outcome unknown');
  await page.waitForTimeout(1_100);
  expect(observed.posts).toHaveLength(2);
  expect(observed.posts[0]!.response?.status()).toBe(201);
  expect(committedBody).not.toBe('');
  const retained = observed.posts[1]!.request.postData();
  await page.getByRole('link', { name: 'Evaluations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evaluations', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Try transactions', exact: true }).click();
  await expect(page.getByTestId('transaction-result')).toContainText('Outcome unknown');
  await expect(page.getByRole('button', { name: 'New transaction', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'High amount', exact: true })).toBeDisabled();
  const savedPath = `${transactionPath}/${encodeURIComponent(observed.posts[1]!.identity.eventId)}`;
  const retrieval = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === savedPath,
  );
  await page.getByRole('button', { name: 'Retrieve saved result', exact: true }).click();
  const saved = await retrieval;
  expect(saved.status()).toBe(200);
  expect(await saved.text()).toBe(committedBody);
  await expect(page.getByTestId('transaction-result')).toContainText(/Saved transaction found/);
  await expect(page.getByTestId('transaction-result')).toContainText('Outcome unknown');
  const replay = nextSubmission(page);
  await page.getByRole('button', { name: 'Replay uncertain transaction', exact: true }).click();
  expect(await submitted(page, await replay, 200)).toBe(committedBody);
  await expect(page.getByTestId('transaction-result')).not.toContainText('Outcome unknown');
  await page.waitForTimeout(1_100);
  expect(observed.posts).toHaveLength(3);
  expect(observed.posts[2]!.request.postData()).toBe(retained);
});

test('playground: a real not-found lookup preserves uncertainty and only a manual same-payload retry submits again', async ({
  page,
}) => {
  const observed = observeSubmissions(page);
  await connect(page);
  await newTransaction(page);
  await page.route(`**${transactionPath}`, (route) => route.abort('failed'), { times: 1 });
  await page.getByRole('button', { name: 'Submit transaction', exact: true }).click();
  await expect(page.getByTestId('transaction-result')).toContainText('Outcome unknown');
  const retained = observed.posts[0]!.request.postData();
  const savedPath = `${transactionPath}/${encodeURIComponent(observed.posts[0]!.identity.eventId)}`;
  const retrieval = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === savedPath,
  );
  await page.getByRole('button', { name: 'Retrieve saved result', exact: true }).click();
  expect((await retrieval).status()).toBe(404);
  await expect(page.getByTestId('transaction-result')).toContainText('Outcome unknown');
  await page.waitForTimeout(1_100);
  expect(observed.posts).toHaveLength(1);
  const replay = nextSubmission(page);
  await page.getByRole('button', { name: 'Replay uncertain transaction', exact: true }).click();
  await submitted(page, await replay, 201);
  await expect(page.getByTestId('transaction-result')).not.toContainText('Outcome unknown');
  expect(observed.posts).toHaveLength(2);
  expect(observed.posts[1]!.request.postData()).toBe(retained);
});

test('playground: a read-only credential receives a definite write rejection and keeps working reads', async ({
  page,
}) => {
  const observed = observeSubmissions(page);
  await connect(page, process.env.E2E_READONLY_KEY!);
  await newTransaction(page);
  const rejected = nextSubmission(page);
  await page.getByRole('button', { name: 'Submit transaction', exact: true }).click();
  expect((await rejected).status()).toBe(403);
  await expect(page.getByTestId('transaction-result')).toContainText(/rejected/i);
  await expect(page.getByTestId('transaction-result')).not.toContainText('Outcome unknown');
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await page.waitForTimeout(1_100);
  expect(observed.posts).toHaveLength(1);
  await page.getByRole('link', { name: 'Evaluations', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'View details', exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
});
