import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const ordinaryKey = 'ordinary.synthetic-test-secret';
const administratorKey = 'administrator.synthetic-test-secret';
const precision = '0.12345678901234567890123456789';
const policyHash = 'a'.repeat(64);
const timestamp = '2026-10-18T12:00:00Z';
const evaluationJson = (eventId = 'evt-precise') => `{
  "id":"00000000-0000-0000-0000-000000000001", "eventId":${JSON.stringify(eventId)},
  "decision":"FLAGGED", "coverage":"COMPLETE", "policyHash":"${policyHash}",
  "buildId":"synthetic-test", "acceptedAt":"${timestamp}", "evaluatedAt":"${timestamp}",
  "contextHighWatermark":9007199254740993,
  "ruleResults":[{"ruleId":"IMPOSSIBLE_TRAVEL","algorithmVersion":"1","status":"MATCH",
    "reasonCode":"TRAVEL_TOO_FAST","evidence":{"currentAccuracyKm":${precision},"distanceKm":1261.34}}]
}`;
const pageJson = (eventId = 'evt-precise', cursor?: string) =>
  `{"items":[${evaluationJson(eventId)}]${cursor ? `,"nextCursor":${JSON.stringify(cursor)}` : ''}}`;
const transactionJson = `{
  "transaction":{"eventId":"evt-precise","customerId":"customer-one","instrumentId":"card-one",
    "transactionType":"CARD_PURCHASE","status":"BOOKED","channel":"CARD_PRESENT",
    "amount":"9999999999999999.9999","currency":"ZAR","category":"OTHER","occurredAt":"${timestamp}",
    "physicalLocation":{"latitude":-33.9249,"longitude":18.4241,"accuracyKm":${precision},
      "source":"VERIFIED_CARD_PRESENT_TERMINAL","city":"Cape Town"}},
  "evaluation":${evaluationJson()}
}`;
const ruleIds = [
  'HIGH_AMOUNT',
  'TRANSACTION_VELOCITY',
  'CUMULATIVE_SPEND',
  'IMPOSSIBLE_TRAVEL',
  'SMALL_PAYMENT_BURST_THEN_LARGE',
];
const rulesJson = JSON.stringify({
  policyHash,
  rules: ruleIds.map((ruleId) => ({
    ruleId,
    algorithmVersion: '1',
    enabled: true,
    settings: { enabled: true },
  })),
});
const administratorJson = `{"revision":9223372036854775807,"policyHash":"${policyHash}","document":{"schemaVersion":1,"canonicalizationVersion":1,"supportedCurrencies":{"ZAR":{"scale":2,"maxAmount":"1000000.00"}},"ingest":{"maxEventAgeSeconds":3600,"maxFutureSkewSeconds":60},"rules":{}}}`;

type ReadOptions = RequestInit & { signal?: AbortSignal };
let fetchMock: ReturnType<typeof vi.fn>;
let storageWrite: ReturnType<typeof vi.spyOn>;

function json(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function defaultRead(path: string) {
  if (path.startsWith('/api/v1/evaluations')) return Promise.resolve(json(pageJson()));
  if (path === '/api/v1/transactions/evt-precise') return Promise.resolve(json(transactionJson));
  if (path === '/api/v1/rules') return Promise.resolve(json(rulesJson));
  if (path === '/api/v1/admin/policy')
    return Promise.resolve(
      json(administratorJson, 200, { ETag: '"policy-revision-9223372036854775807"' }),
    );
  throw new Error(`Unexpected synthetic API route: ${path}`);
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  localStorage.clear();
  sessionStorage.clear();
  storageWrite = vi.spyOn(Storage.prototype, 'setItem');
  fetchMock = vi.fn().mockImplementation(defaultRead);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function connect(user: ReturnType<typeof userEvent.setup>, key = ordinaryKey) {
  await user.type(screen.getByLabelText('API key', { exact: true }), key);
  await user.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByRole('button', { name: 'Disconnect' });
}

async function policy(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('link', { name: 'Policy' }));
  await screen.findByRole('heading', { name: 'Policy' });
  await screen.findByRole('heading', { name: 'High amount' });
}

describe('assessment workspace and connection', () => {
  it('connects through the real client, clears the password input and never writes browser storage', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Fraud Rule Engine — Assessment Demo' }),
    ).toBeInTheDocument();
    const input = screen.getByLabelText('API key', { exact: true });
    expect(input).toHaveAttribute('type', 'password');
    await user.type(input, ordinaryKey);
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(input).toHaveValue('');
    await screen.findByRole('table');
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/v1/evaluations?pageSize=1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-API-Key': ordinaryKey }),
      }),
    ]);
    expect(document.body.textContent).not.toContain(ordinaryKey);
    expect(storageWrite).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('shows an authentication failure with an empty key input and no connected data', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json('{"code":"UNAUTHORIZED","correlationId":"denied-test"}', 401)),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('API key', { exact: true }), ordinaryKey);
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /key.*no longer accepted|credential|unauthori[sz]ed/i,
    );
    expect(screen.getByLabelText('API key', { exact: true })).toHaveValue('');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it('disconnects both credentials, removes saved data and does not restore administrator access on reconnect', async () => {
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    await user.click(await screen.findByRole('button', { name: 'View details' }));
    expect(await screen.findByRole('heading', { name: 'Evaluation details' })).toBeInTheDocument();
    await screen.findAllByText(precision, { exact: true });
    await policy(user);
    await user.click(screen.getByText('Administrator access', { exact: false }));
    const input = screen.getByLabelText('Administrator API key', { exact: true });
    await user.type(input, administratorKey);
    await user.click(screen.getByRole('button', { name: 'Connect administrator' }));
    expect(input).toHaveValue('');
    await screen.findByText('Administrator connected', { exact: true });
    await screen.findByText('9223372036854775807', { exact: true });
    const administrationCalls = fetchMock.mock.calls.filter(
      ([path]) => path === '/api/v1/admin/policy',
    ).length;

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.queryByText(policyHash, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Administrator connected', { exact: true })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Administrator policy snapshot' }),
    ).not.toBeInTheDocument();
    await connect(user, 'other.synthetic-test-secret');
    await screen.findByRole('heading', { name: 'High amount' });
    expect(screen.queryByText('Administrator connected', { exact: true })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/v1/admin/policy')).toHaveLength(
      administrationCalls,
    );
    await user.click(screen.getByRole('link', { name: 'Try transactions' }));
    await screen.findByRole('heading', { name: 'Try transactions' });
    expect(screen.queryByTestId('evaluation-details')).not.toBeInTheDocument();
    expect(storageWrite).not.toHaveBeenCalled();
  });

  it('clears a connected session and saved evaluations after the credential is revoked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    await screen.findByRole('table');
    fetchMock.mockImplementation(() =>
      Promise.resolve(json('{"code":"UNAUTHORIZED","correlationId":"revoked-test"}', 401)),
    );
    await user.click(screen.getByRole('button', { name: 'Refresh evaluations' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/credential.*no longer accepted/i);
    expect(screen.getByLabelText('API key', { exact: true })).toHaveValue('');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('evt-precise', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });
});

describe('read views and request lifecycle', () => {
  it('aborts an old read when navigating and ignores its late result', async () => {
    let resolveOld!: (response: Response) => void;
    let oldSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((path: string, options: ReadOptions) => {
      if (path === '/api/v1/evaluations') {
        oldSignal = options.signal;
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      }
      return defaultRead(path);
    });
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    await waitFor(() => expect(oldSignal).toBeDefined());
    expect(oldSignal?.aborted).toBe(false);
    await policy(user);
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      resolveOld(json(pageJson('evt-late-result')));
    });
    expect(screen.getByRole('heading', { name: 'Policy' })).toBeInTheDocument();
    expect(screen.queryByText('evt-late-result', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('validates date filters before requesting data', async () => {
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    await screen.findByRole('table');
    const requests = fetchMock.mock.calls.length;
    await user.type(screen.getByLabelText('Accepted from', { exact: true }), '2026-10-18T10:00:00');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/timezone offset/i);
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    await user.clear(screen.getByLabelText('Accepted from', { exact: true }));
    await user.type(
      screen.getByLabelText('Accepted from', { exact: true }),
      '2026-10-18T11:00:00Z',
    );
    await user.type(screen.getByLabelText('Accepted to', { exact: true }), '2026-10-18T10:00:00Z');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/earlier than/i);
    expect(fetchMock).toHaveBeenCalledTimes(requests);
  });

  it('preserves microsecond filter bounds and the same explicit filters through cursor pagination', async () => {
    fetchMock.mockImplementation((path: string) =>
      path.startsWith('/api/v1/evaluations')
        ? Promise.resolve(
            json(
              pageJson(
                'evt-precise',
                new URL(path, 'http://localhost').searchParams.has('cursor')
                  ? undefined
                  : 'opaque+cursor==',
              ),
            ),
          )
        : defaultRead(path),
    );
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    await screen.findByRole('table');
    const from = '2026-10-18T10:00:00.123456Z';
    const laterTo = '2026-10-18T13:00:00.654321+02:00';
    await user.type(screen.getByLabelText('Accepted from', { exact: true }), from);
    await user.type(screen.getByLabelText('Accepted to', { exact: true }), laterTo);
    await user.type(screen.getByLabelText('Customer ID', { exact: true }), 'customer-one');
    await user.selectOptions(screen.getByLabelText('Decision', { exact: true }), 'FLAGGED');
    await user.type(screen.getByLabelText('Page size', { exact: true }), '1');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled());
    const filteredPath = fetchMock.mock.calls.at(-1)![0] as string;
    const filtered = new URL(filteredPath, 'http://localhost');
    expect(filtered.searchParams.get('acceptedFrom')).toBe(from);
    expect(filtered.searchParams.get('acceptedTo')).toBe(laterTo);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled(),
    );
    const next = new URL(fetchMock.mock.calls.at(-1)![0] as string, 'http://localhost');
    expect(next.searchParams.get('cursor')).toBe('opaque+cursor==');
    next.searchParams.delete('cursor');
    expect(next.search).toBe(filtered.search);
  });

  it('renders exact evidence, original money and history integers without invented totals', async () => {
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    expect(await screen.findByText('1 on this page', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/\b(total|analytics|fraud rate)\b/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View details' }));
    const details = await screen.findByTestId('evaluation-details');
    const ruleHeading = await within(details).findByRole('heading', { name: 'Impossible travel' });
    expect(
      within(ruleHeading.closest('article')!).getByText(precision, { exact: true }),
    ).toBeInTheDocument();
    expect(within(details).getByText('9007199254740993', { exact: true })).toBeInTheDocument();
    expect(
      within(details).getByText('ZAR 9999999999999999.9999', { exact: true }),
    ).toBeInTheDocument();
    expect(within(details).getByText(/^current accuracy km$/i)).toBeInTheDocument();
    await user.click(within(details).getByText('Submitted location', { exact: true }));
    expect(within(details).getByText('-33.9249', { exact: true })).toBeVisible();
    expect(within(details).getByText('18.4241', { exact: true })).toBeVisible();
    expect(within(details).getByText('Cape Town', { exact: true })).toBeVisible();
    await user.click(within(details).getByText('Raw API response', { exact: true }));
    const raw = within(details).getByLabelText('Raw API response');
    expect(raw.textContent).toContain(precision);
    expect(raw.textContent).not.toContain('0.12345678901234568');
    expect(raw.textContent).toContain('9007199254740993');
    for (const [, options] of fetchMock.mock.calls) expect(options.method).toBe('GET');
  });

  it('keeps the ordinary session when an administrator permission check is denied', async () => {
    fetchMock.mockImplementation((path: string) =>
      path === '/api/v1/admin/policy'
        ? Promise.resolve(json('{"code":"FORBIDDEN","correlationId":"permission-test"}', 403))
        : defaultRead(path),
    );
    const user = userEvent.setup();
    render(<App />);
    await connect(user);
    await policy(user);
    await user.click(screen.getByText('Administrator access', { exact: false }));
    await user.type(screen.getByLabelText('Administrator API key', { exact: true }), ordinaryKey);
    await user.click(screen.getByRole('button', { name: 'Connect administrator' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission/i);
    expect(screen.getByLabelText('Administrator API key', { exact: true })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'High amount' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Administrator policy snapshot' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /activate|validate/i })).not.toBeInTheDocument();
  });
});
