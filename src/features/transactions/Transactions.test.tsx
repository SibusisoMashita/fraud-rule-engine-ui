import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App';

const key = 'workflow.synthetic-test-key';
const precision = '0.12345678901234567890123456789';
const hash = 'a'.repeat(64);
let fetchMock: ReturnType<typeof vi.fn>;

function json(raw: string, status = 200) {
  return new Response(raw, { status, headers: { 'Content-Type': 'application/json' } });
}

function resource(raw: string) {
  const identity = JSON.parse(raw) as { eventId: string };
  return `{"transaction":${raw},"evaluation":{
    "id":"00000000-0000-0000-0000-000000000001","eventId":${JSON.stringify(identity.eventId)},
    "decision":"FLAGGED","coverage":"COMPLETE","policyHash":"${hash}","buildId":"workflow-test",
    "acceptedAt":"2026-10-18T12:00:00Z","evaluatedAt":"2026-10-18T12:00:00Z","contextHighWatermark":9007199254740993,
    "ruleResults":[{"ruleId":"IMPOSSIBLE_TRAVEL","algorithmVersion":"1","status":"MATCH",
    "reasonCode":"TRAVEL_TOO_FAST","evidence":{"currentAccuracyKm":${precision}}}]}}`;
}

function defaultRead(path: string) {
  if (path.startsWith('/api/v1/evaluations')) return Promise.resolve(json('{"items":[]}'));
  if (path === '/api/v1/rules')
    return Promise.resolve(
      json(
        JSON.stringify({
          policyHash: hash,
          rules: [
            {
              ruleId: 'HIGH_AMOUNT',
              algorithmVersion: '1',
              enabled: true,
              settings: { enabled: true, thresholds: { ZAR: '25000.00', USD: '1500.00' } },
            },
          ],
        }),
      ),
    );
  return Promise.resolve(json('{"code":"NOT_FOUND","correlationId":"workflow-not-found"}', 404));
}

function posts() {
  return fetchMock.mock.calls.filter(([, options]) => options.method === 'POST') as Array<
    [string, RequestInit & { body: string }]
  >;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/#transactions');
  localStorage.clear();
  sessionStorage.clear();
  fetchMock = vi.fn().mockImplementation(defaultRead);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function start(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.type(screen.getByLabelText('API key', { exact: true }), key);
  await user.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByRole('button', { name: 'Disconnect' });
  await screen.findByRole('option', { name: 'ZAR' });
}

async function replace(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const input = screen.getByLabelText(label, { exact: true });
  await user.clear(input);
  await user.type(input, value);
}

async function manual(user: ReturnType<typeof userEvent.setup>, amount = '1234.50') {
  await replace(user, 'Amount', amount);
  return screen.getByLabelText<HTMLInputElement>('Event ID', { exact: true }).value;
}

function result() {
  return within(screen.getByTestId('transaction-result'));
}

describe('transaction playground workflows', () => {
  it('normalizes decimal entry on Enter just as on blur and retains exact replay text', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (options.method !== 'POST') return defaultRead(path);
      return Promise.resolve(
        posts().length === 2
          ? json('{"code":"EVENT_CONTENT_CONFLICT"}', 409)
          : json(resource(options.body as string), posts().length === 1 ? 201 : 200),
      );
    });
    await start(user);
    await manual(user, '.50');
    await user.keyboard('{Enter}');
    await result().findByRole('heading', { name: 'Saved' });
    const original = posts()[0][1].body;
    expect(original).toContain('"amount":"0.50"');
    await user.type(screen.getByLabelText('Conflicting amount', { exact: true }), '000.51');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(posts()).toHaveLength(2));
    await result().findByRole('heading', { name: 'Rejected' });
    expect(posts()[1][1].body).toContain('"amount":"0.51"');
    await user.click(screen.getByRole('button', { name: /^View submission 1:/ }));
    await user.click(screen.getByRole('button', { name: 'Replay identical payload' }));
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(posts()[2][1].body).toBe(original);
  });

  it('identifies every step needing a newly supported currency without silently changing money', async () => {
    const user = userEvent.setup();
    await start(user);
    await user.click(screen.getByRole('button', { name: 'Cumulative spend' }));
    fetchMock.mockImplementation((path: string) =>
      path === '/api/v1/rules'
        ? Promise.resolve(
            json(
              JSON.stringify({
                policyHash: 'b'.repeat(64),
                rules: [
                  {
                    ruleId: 'HIGH_AMOUNT',
                    algorithmVersion: '1',
                    enabled: false,
                    settings: { thresholds: { USD: '1000.00' } },
                  },
                ],
              }),
            ),
          )
        : defaultRead(path),
    );
    await user.click(screen.getByRole('button', { name: 'Reload currencies' }));
    await screen.findByText('Choose an active currency for transaction steps 1, 2 before sending.');
    expect(screen.getByRole('button', { name: 'Run scenario' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Currency', { exact: true }), 'USD');
    expect(
      screen.getByText('Choose an active currency for transaction steps 2 before sending.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Edit transaction 2:/ }));
    await user.selectOptions(screen.getByLabelText('Currency', { exact: true }), 'USD');
    expect(screen.getByLabelText('Amount', { exact: true })).toHaveValue('16000.00');
    expect(screen.getByRole('button', { name: 'Run scenario' })).toBeEnabled();
    expect(posts()).toHaveLength(0);
  });

  it('uses backend currency choices and keeps generated identity fields read-only until a new run', async () => {
    const user = userEvent.setup();
    await start(user);
    const currency = screen.getByRole('combobox', { name: 'Currency' });
    const choices = within(currency)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);
    expect(choices).toEqual(['USD', 'ZAR']);
    const identity = ['Event ID', 'Customer ID', 'Instrument ID'].map((label) => {
      const input = screen.getByLabelText<HTMLInputElement>(label, { exact: true });
      expect(input).toHaveProperty('readOnly', true);
      return input.value;
    });
    expect(screen.getByLabelText('Occurred at', { exact: true })).toHaveProperty('readOnly', true);
    await manual(user, '123.45');
    await user.selectOptions(currency, 'USD');
    await replace(user, 'Category', 'TRAVEL');
    for (const [index, label] of ['Event ID', 'Customer ID', 'Instrument ID'].entries()) {
      expect(screen.getByLabelText(label, { exact: true })).toHaveValue(identity[index]);
    }
    await user.click(screen.getByRole('button', { name: 'New transaction' }));
    for (const [index, label] of ['Event ID', 'Customer ID', 'Instrument ID'].entries()) {
      expect(screen.getByLabelText(label, { exact: true })).not.toHaveValue(identity[index]);
    }
    expect(posts()).toHaveLength(0);
  });

  it('accepts exact plain decimal amounts and rejects pasted letters, exponents and signs', async () => {
    const user = userEvent.setup();
    await start(user);
    const amount = screen.getByLabelText('Amount', { exact: true });
    expect(amount).toHaveAttribute('type', 'text');
    expect(amount).toHaveAttribute('inputmode', 'decimal');
    await user.clear(amount);
    for (const invalid of ['letters', '1e3', '1E3', '-1', '+1', '1.2.3']) {
      await user.click(amount);
      await user.paste(invalid);
      expect(amount).toHaveValue('');
    }
    await user.paste('9007199254740993.9999');
    expect(amount).toHaveValue('9007199254740993.9999');
    expect(posts()).toHaveLength(0);
  });

  it('selects sample real coordinates and keeps location fields locked to the chosen physical channel', async () => {
    const user = userEvent.setup();
    await start(user);
    expect(screen.getByLabelText('Include physical location', { exact: true })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Channel', { exact: true }), 'CARD_PRESENT');
    await user.click(screen.getByLabelText('Include physical location', { exact: true }));
    await user.selectOptions(
      screen.getByLabelText('Demo location', { exact: true }),
      'johannesburg',
    );
    for (const [label, value] of [
      ['Latitude', '-26.2041'],
      ['Longitude', '28.0473'],
      ['City', 'Johannesburg'],
    ]) {
      const input = screen.getByLabelText(label, { exact: true });
      expect(input).toHaveValue(value);
      expect(input).toHaveProperty('readOnly', true);
    }
    expect(screen.getByLabelText('Accuracy (km)', { exact: true })).toHaveProperty(
      'readOnly',
      true,
    );
    const source = screen.getByLabelText('Location source', { exact: true });
    expect(source.matches('[readonly], :disabled')).toBe(true);
    const map = screen.getByRole('link', { name: /View on Google Maps/ });
    expect(map).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=-26.2041%2C28.0473',
    );
    expect(map).toHaveAttribute('target', '_blank');
    expect(map).toHaveAttribute('rel', 'noopener noreferrer');
    await user.selectOptions(
      screen.getByLabelText('Transaction type', { exact: true }),
      'ATM_WITHDRAWAL',
    );
    expect(screen.getByLabelText('Channel', { exact: true })).toHaveValue('ATM');
    expect(
      within(screen.getByLabelText('Channel', { exact: true })).getAllByRole('option'),
    ).toHaveLength(1);
    await user.selectOptions(
      screen.getByLabelText('Transaction type', { exact: true }),
      'CARD_PURCHASE',
    );
    expect(screen.getByLabelText('Channel', { exact: true })).toHaveValue('ECOMMERCE');
    expect(screen.getByLabelText('Transaction type', { exact: true })).toHaveValue('CARD_PURCHASE');
    expect(screen.getByLabelText('Include physical location', { exact: true })).toBeDisabled();
    expect(screen.queryByLabelText('Demo location', { exact: true })).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it('submits string money and selected real coordinates, then preserves precise evidence through replay and conflicting-duplicate responses', async () => {
    const user = userEvent.setup();
    let count = 0;
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (options.method !== 'POST') return defaultRead(path);
      count++;
      return Promise.resolve(
        count < 3
          ? json(resource(options.body as string), count === 1 ? 201 : 200)
          : json('{"code":"EVENT_CONTENT_CONFLICT","correlationId":"workflow-conflict"}', 409),
      );
    });
    await start(user);
    const eventId = await manual(user);
    await user.selectOptions(screen.getByLabelText('Channel', { exact: true }), 'CARD_PRESENT');
    await user.click(screen.getByLabelText('Include physical location', { exact: true }));
    await user.selectOptions(screen.getByLabelText('Demo location', { exact: true }), 'cape-town');
    await user.click(screen.getByRole('button', { name: 'Submit transaction' }));
    await result().findByText('HTTP 201', { exact: true });
    const original = posts()[0][1].body;
    expect(original).toContain('"amount":"1234.50"');
    expect(original).toContain('"latitude":-33.9249');
    expect(original).toContain('"longitude":18.4241');
    expect(JSON.parse(original).amount).toBe('1234.50');
    expect(result().getByText('ZAR 1234.50', { exact: true })).toBeInTheDocument();
    expect(result().getByText(precision, { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Replay identical payload' }));
    await result().findByText('HTTP 200', { exact: true });
    expect(posts()[1][1].body).toBe(original);
    await user.type(screen.getByLabelText('Conflicting amount', { exact: true }), '1235.50');
    await user.click(screen.getByRole('button', { name: 'Conflicting duplicate' }));
    expect(await result().findByRole('alert')).toHaveTextContent(
      /already associated with different content/i,
    );
    expect(result().getByRole('heading', { name: 'Rejected' })).toBeInTheDocument();
    const conflicting = JSON.parse(posts()[2][1].body) as { eventId: string; amount: string };
    expect(conflicting).toMatchObject({ eventId, amount: '1235.50' });
    expect(posts()).toHaveLength(3);
    const savedSubmission = screen.getByRole('button', { name: /^View submission 1:/ });
    expect(savedSubmission).toHaveAccessibleName(new RegExp(`${eventId} Saved$`));
    expect(savedSubmission).toHaveTextContent(eventId);
    await user.click(savedSubmission);
    expect(result().getByText('ZAR 1234.50', { exact: true })).toBeInTheDocument();
  });

  it('rejects a numerically identical conflicting amount without sending another request', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((path: string, options: RequestInit) =>
      options.method === 'POST'
        ? Promise.resolve(json(resource(options.body as string), 201))
        : defaultRead(path),
    );
    await start(user);
    await manual(user, '100.00');
    await user.click(screen.getByRole('button', { name: 'Submit transaction' }));
    await result().findByText('HTTP 201', { exact: true });
    await user.type(screen.getByLabelText('Conflicting amount', { exact: true }), '100.0');
    await user.click(screen.getByRole('button', { name: 'Conflicting duplicate' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/different amount/i);
    expect(posts()).toHaveLength(1);
  });

  it.each([422, 503])(
    'sends scenario history sequentially and stops after the first HTTP %s failure',
    async (status) => {
      let resolveFirst!: (response: Response) => void;
      let firstRaw = '';
      const user = userEvent.setup();
      fetchMock.mockImplementation((path: string, options: RequestInit) => {
        if (options.method !== 'POST') return defaultRead(path);
        if (posts().length === 1) {
          firstRaw = options.body as string;
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(json('{"code":"SYNTHETIC_STOP"}', status));
      });
      await start(user);
      await user.click(screen.getByRole('button', { name: 'Transaction velocity' }));
      await user.click(screen.getByRole('button', { name: 'Run scenario' }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(screen.getByRole('button', { name: 'Stop run' })).toBeInTheDocument();
      await act(async () => {
        resolveFirst(json(resource(firstRaw), 201));
      });
      await result().findByRole('heading', {
        name: status === 503 ? 'Outcome unknown' : 'Rejected',
      });
      expect(posts()).toHaveLength(2);
      const first = JSON.parse(firstRaw) as {
        eventId: string;
        customerId: string;
        instrumentId: string;
        occurredAt: string;
      };
      const second = JSON.parse(posts()[1][1].body) as typeof first;
      expect(second.eventId).not.toBe(first.eventId);
      expect(second.customerId).toBe(first.customerId);
      expect(second.instrumentId).toBe(first.instrumentId);
      expect(Date.parse(second.occurredAt)).toBeGreaterThan(Date.parse(first.occurredAt));
      expect(screen.getAllByRole('button', { name: /^View submission / })).toHaveLength(2);
    },
  );

  it('validates every scenario step before dispatching any transaction', async () => {
    const user = userEvent.setup();
    await start(user);
    await user.click(screen.getByRole('button', { name: 'Cumulative spend' }));
    const secondStep = screen.getByRole('button', { name: /^Edit transaction 2:/ });
    expect(secondStep).toHaveAccessibleName(/ZAR 16000\.00$/);
    expect(secondStep).toHaveTextContent('ZAR 16000.00');
    await user.click(secondStep);
    await replace(user, 'Amount', '0');
    await user.click(screen.getByRole('button', { name: /^Edit transaction 1:/ }));
    await user.click(screen.getByRole('button', { name: 'Run scenario' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/positive decimal/i);
    expect(posts()).toHaveLength(0);
    expect(screen.queryByRole('list', { name: 'Submission history' })).not.toBeInTheDocument();
  });

  it('refreshes scenario times once at submission while preserving history spacing, IDs and replay payloads', async () => {
    const user = userEvent.setup();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    fetchMock.mockImplementation((path: string, options: RequestInit) =>
      options.method === 'POST'
        ? Promise.resolve(json(resource(options.body as string), 201))
        : defaultRead(path),
    );
    await start(user);
    await user.click(screen.getByRole('button', { name: 'Small payment burst' }));
    const firstId = screen.getByLabelText<HTMLInputElement>('Event ID', { exact: true }).value;
    const draftTime = screen.getByLabelText<HTMLInputElement>('Occurred at', { exact: true }).value;
    now += 3_600_000;
    await user.click(screen.getByRole('button', { name: 'Run scenario' }));
    await waitFor(() => expect(posts()).toHaveLength(4));
    await result().findByRole('heading', { name: 'Saved' });
    const events = posts().map(
      ([, options]) =>
        JSON.parse(options.body) as {
          eventId: string;
          occurredAt: string;
        },
    );
    expect(events[0].eventId).toBe(firstId);
    expect(events[0].occurredAt).not.toBe(draftTime);
    expect(events.map((event) => Date.parse(event.occurredAt))).toEqual([
      now - 180_000,
      now - 120_000,
      now - 60_000,
      now,
    ]);
    const retained = posts()[3][1].body;
    now += 3_600_000;
    await user.click(screen.getByRole('button', { name: 'Replay identical payload' }));
    await waitFor(() => expect(posts()).toHaveLength(5));
    expect(posts()[4][1].body).toBe(retained);
  });

  it('retains an uncertain payload through 404 and a found result, resolving identity only after explicit identical replay', async () => {
    const user = userEvent.setup();
    let eventId = '';
    let retained = '';
    let getCount = 0;
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (options.method === 'POST') {
        if (posts().length === 1) {
          retained = options.body as string;
          return Promise.reject(new TypeError('Synthetic lost response'));
        }
        return Promise.resolve(json(resource(options.body as string), 200));
      }
      if (path === `/api/v1/transactions/${eventId}`) {
        getCount++;
        return Promise.resolve(
          getCount === 1 ? json('{"code":"NOT_FOUND"}', 404) : json(resource(retained)),
        );
      }
      return defaultRead(path);
    });
    await start(user);
    eventId = await manual(user);
    await user.click(screen.getByRole('button', { name: 'Submit transaction' }));
    await result().findByRole('heading', { name: 'Outcome unknown' });
    expect(screen.getByLabelText('Event ID', { exact: true })).toHaveValue(eventId);
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeDisabled();
    expect(posts()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Retrieve saved result' }));
    expect(await result().findByRole('status')).toHaveTextContent(/404 does not prove/i);
    expect(result().getByRole('heading', { name: 'Outcome unknown' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retrieve saved result' }));
    expect(await result().findByRole('status')).toHaveTextContent(/replay.*confirm it matches/i);
    expect(result().getByRole('heading', { name: 'Outcome unknown' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeDisabled();
    expect(posts()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Replay uncertain transaction' }));
    await result().findByRole('heading', { name: 'Saved' });
    expect(posts()).toHaveLength(2);
    expect(posts()[1][1].body).toBe(retained);
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeEnabled();
  });

  it('cancels an in-flight submission on navigation and keeps the same uncertain journal when returning', async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (options.method !== 'POST') return defaultRead(path);
      signal = options.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true },
        );
      });
    });
    await start(user);
    const eventId = await manual(user);
    await user.click(screen.getByRole('button', { name: 'Submit transaction' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const retained = posts()[0][1].body;
    await user.click(screen.getByRole('link', { name: 'Evaluations' }));
    await screen.findByRole('heading', { name: 'Evaluations' });
    expect(signal?.aborted).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Try transactions' }));
    await result().findByRole('heading', { name: 'Outcome unknown' });
    expect(screen.getByLabelText('Event ID', { exact: true })).toHaveValue(eventId);
    await user.click(result().getByText('Retained request payload', { exact: true }));
    expect(JSON.parse(result().getByLabelText('Retained request payload').textContent!)).toEqual(
      JSON.parse(retained),
    );
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeDisabled();
  });

  it.each([
    { status: 403, incomplete: false },
    { status: 429, incomplete: false },
    { status: 403, incomplete: true },
  ])(
    'keeps earlier uncertainty when replay receives HTTP $status (incomplete body: $incomplete)',
    async ({ status, incomplete }) => {
      const user = userEvent.setup();
      fetchMock.mockImplementation((path: string, options: RequestInit) => {
        if (options.method !== 'POST') return defaultRead(path);
        if (posts().length === 1)
          return Promise.reject(new TypeError('Synthetic lost first response'));
        const received = json('{"code":"REPLAY_REJECTED"}', status);
        if (incomplete)
          vi.spyOn(received, 'text').mockRejectedValue(
            new TypeError('Synthetic interrupted error body'),
          );
        return Promise.resolve(received);
      });
      await start(user);
      await manual(user);
      await user.click(screen.getByRole('button', { name: 'Submit transaction' }));
      await result().findByRole('heading', { name: 'Outcome unknown' });
      const retained = posts()[0][1].body;
      await user.click(screen.getByRole('button', { name: 'Replay uncertain transaction' }));
      await waitFor(() =>
        expect(result().getByRole('alert')).toHaveTextContent(
          status === 403 ? /permission/i : /request limit/i,
        ),
      );
      expect(result().getByRole('heading', { name: 'Outcome unknown' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'New transaction' })).toBeDisabled();
      expect(posts()).toHaveLength(2);
      expect(posts()[1][1].body).toBe(retained);
    },
  );

  it('keeps an initial interrupted 403 rejected without blocking a new transaction or clearing the connection', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (options.method !== 'POST') return defaultRead(path);
      const received = json('{}', 403);
      vi.spyOn(received, 'text').mockRejectedValue(
        new TypeError('Synthetic interrupted error body'),
      );
      return Promise.resolve(received);
    });
    await start(user);
    await manual(user);
    await user.click(screen.getByRole('button', { name: 'Submit transaction' }));
    await result().findByRole('heading', { name: 'Rejected' });
    expect(result().getByRole('alert')).toHaveTextContent(/permission/i);
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });

  it('retains an uncertain generated ID payload when retrieval finds different content, until an explicit replay returns 409', async () => {
    const user = userEvent.setup();
    let eventId = '';
    let retained = '';
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (options.method === 'POST') {
        if (posts().length === 1) {
          retained = options.body as string;
          return Promise.reject(new TypeError('Synthetic lost response'));
        }
        return Promise.resolve(json('{"code":"EVENT_CONTENT_CONFLICT"}', 409));
      }
      if (path === `/api/v1/transactions/${eventId}`) {
        const different = JSON.stringify({ ...JSON.parse(retained), amount: '999.99' });
        return Promise.resolve(json(resource(different)));
      }
      return defaultRead(path);
    });
    await start(user);
    eventId = await manual(user, '1234.50');
    await user.click(screen.getByRole('button', { name: 'Submit transaction' }));
    await result().findByRole('heading', { name: 'Outcome unknown' });
    await user.click(screen.getByRole('button', { name: 'Retrieve saved result' }));
    await result().findByText('ZAR 999.99', { exact: true });
    expect(result().getByRole('heading', { name: 'Outcome unknown' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeDisabled();
    expect(screen.getByLabelText('Amount', { exact: true })).toHaveValue('1234.50');
    expect(posts()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Replay uncertain transaction' }));
    await result().findByRole('heading', { name: 'Rejected' });
    expect(posts()[1][1].body).toBe(retained);
    expect(result().queryByText('ZAR 999.99', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeEnabled();
  });

  it('clears the journal on disconnect and ignores a late acknowledgement from the previous connection', async () => {
    const user = userEvent.setup();
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    let resolveLate!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (options.method !== 'POST') return defaultRead(path);
      signal = options.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        resolveLate = resolve;
      });
    });
    await start(user);
    const eventId = await manual(user);
    await user.click(screen.getByRole('button', { name: 'Submit transaction' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const raw = posts()[0][1].body;
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId('transaction-result')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Submission history' })).not.toBeInTheDocument();
    await act(async () => {
      resolveLate(json(resource(raw), 201));
    });
    expect(screen.queryByTestId('transaction-result')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Event ID', { exact: true })).not.toHaveValue(eventId);
    expect(screen.getByLabelText('API key', { exact: true })).toHaveValue('');
    expect(storageWrite).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
