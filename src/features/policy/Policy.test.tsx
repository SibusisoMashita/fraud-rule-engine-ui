import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLosslessNumber } from 'lossless-json';
import { App } from '../../app/App';
import {
  at,
  changeCurrency,
  changeField,
  fieldText,
  numericInput,
  parseDraft,
  policyChanges,
} from './model';

const originalHash = 'a'.repeat(64);
const candidateHash = 'b'.repeat(64);
const precision = '0.12345678901234567890123456789';
const source = `{
  "schemaVersion":1,"canonicalizationVersion":1,
  "supportedCurrencies":{"ZAR":{"scale":2,"maxAmount":"1000000.00"}},
  "ingest":{"maxEventAgeSeconds":3600,"maxFutureSkewSeconds":60},
  "rules":{
    "highAmount":{"enabled":true,"thresholds":{"ZAR":"25000.00"}},
    "transactionVelocity":{"enabled":true,"windowSeconds":600,"maxTransactions":5},
    "cumulativeSpend":{"enabled":true,"windowSeconds":1800,"thresholds":{"ZAR":"30000.00"}},
    "impossibleTravel":{"enabled":true,"maxComparisonAgeSeconds":7200,"maxCandidates":20,"maxSpeedKmh":900,"minDistanceKm":50,"travelAllowanceKm":10,"maxAccuracyKm":${precision},"trustedSources":["VERIFIED_ATM_TERMINAL","VERIFIED_CARD_PRESENT_TERMINAL"],"eligibleChannels":["ATM","CARD_PRESENT"]},
    "smallPaymentBurstThenLarge":{"enabled":true,"windowSeconds":900,"minSmallPayments":3,"smallPaymentMaximum":{"ZAR":"20.00"},"largePaymentThreshold":{"ZAR":"5000.00"}},
    "futureRegisteredRule":{"enabled":false,"setting":9007199254740993,"amount":"13.0000"}
  },"futureSetting":{"retain":true}
}`;
let fetchMock: ReturnType<typeof vi.fn>;
let revision: string;
let activeHash: string;
let activeDocument: string;

function json(raw: string, status = 200, headers: HeadersInit = {}) {
  return new Response(raw, { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
function snapshot(document = activeDocument, hash = activeHash, version = revision) {
  return json(`{"revision":${version},"policyHash":"${hash}","document":${document}}`, 200, {
    ETag: `"policy-revision-${version}"`,
  });
}
function defaultResponse(path: string, options: RequestInit) {
  if (path.startsWith('/api/v1/evaluations')) return Promise.resolve(json('{"items":[]}'));
  if (path === '/api/v1/rules')
    return Promise.resolve(json(`{"policyHash":"${activeHash}","rules":[]}`));
  if (path === '/api/v1/admin/policy/validate')
    return Promise.resolve(json(`{"policyHash":"${candidateHash}"}`));
  if (path === '/api/v1/admin/policy' && options.method === 'PUT') {
    activeDocument = options.body as string;
    activeHash = candidateHash;
    revision = '2';
  }
  if (path === '/api/v1/admin/policy') return Promise.resolve(snapshot());
  throw new Error(`Unexpected synthetic route ${path}`);
}
function writes(method: 'POST' | 'PUT') {
  return fetchMock.mock.calls.filter(([, options]) => options.method === method) as [
    string,
    RequestInit & { body: string },
  ][];
}
const editor = () => within(screen.getByRole('region', { name: 'Policy editor' }));

beforeEach(() => {
  window.history.replaceState({}, '', '/#policy');
  revision = '1';
  activeHash = originalHash;
  activeDocument = source;
  fetchMock = vi.fn().mockImplementation(defaultResponse);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function start(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.type(screen.getByLabelText('API key', { exact: true }), 'ordinary.policy-test-key');
  await user.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByRole('button', { name: 'Disconnect' });
  await user.type(screen.getByLabelText('Administrator API key'), 'administrator.policy-test-key');
  await user.click(screen.getByRole('button', { name: 'Connect administrator' }));
  await screen.findByLabelText('High amount threshold (ZAR)');
}
async function replace(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const input = editor().getByLabelText(label, { exact: true });
  await user.clear(input);
  if (value) await user.type(input, value);
}
async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.click(editor().getByRole('button', { name: 'Validate draft' }));
  await user.click(await editor().findByRole('button', { name: 'Review changes' }));
  return editor().getByRole('button', { name: 'Activate policy' });
}

describe('policy draft model', () => {
  it('edits known fields without rounding numbers or discarding future registered settings', () => {
    const changed = changeField(source, ['rules', 'highAmount', 'thresholds', 'ZAR'], '19.0000');
    const document = parseDraft(changed, true);
    expect(fieldText(at(document, ['rules', 'impossibleTravel', 'maxAccuracyKm']))).toBe(precision);
    expect(fieldText(at(document, ['rules', 'futureRegisteredRule', 'setting']))).toBe(
      '9007199254740993',
    );
    expect(at(document, ['futureSetting', 'retain'])).toBe(true);
    expect(at(document, ['rules', 'highAmount', 'thresholds', 'ZAR'])).toBe('19.0000');
  });
  it('retains unfinished numeric input in the shared draft and requires JSON numbers for validation', () => {
    const raw = changeField(
      source,
      ['rules', 'impossibleTravel', 'maxCandidates'],
      numericInput(''),
    );
    expect(fieldText(at(parseDraft(raw), ['rules', 'impossibleTravel', 'maxCandidates']))).toBe('');
    expect(() => parseDraft(raw, true)).toThrow(
      'rules.impossibleTravel.maxCandidates must be a JSON number',
    );
    const precise = numericInput(precision);
    expect(isLosslessNumber(precise)).toBe(true);
    expect(fieldText(precise)).toBe(precision);
  });
  it('adds currencies with blank values rather than inventing business policy and removes known maps together', () => {
    const added = changeCurrency(source, 'USD');
    expect(at(parseDraft(added), ['supportedCurrencies', 'USD'])).toEqual({
      scale: '',
      maxAmount: '',
    });
    expect(at(parseDraft(added), ['rules', 'highAmount', 'thresholds', 'USD'])).toBe('');
    expect(() => parseDraft(added, true)).toThrow('supportedCurrencies.USD.scale');
    const removed = changeCurrency(added, 'USD', true);
    expect(
      at(parseDraft(removed, true), [
        'rules',
        'smallPaymentBurstThenLarge',
        'largePaymentThreshold',
        'USD',
      ]),
    ).toBeUndefined();
    expect(() => changeCurrency(source, 'ZAR')).toThrow('already present');
  });
  it('rejects divergent duplicate keys and malformed structure with safe messages but leaves bounds to the engine', () => {
    expect(() => parseDraft('{"rules":{},"rules":null}')).toThrow('Policy JSON must be valid JSON');
    expect(() => parseDraft('{"rules":null}')).toThrow('supportedCurrencies must be an object');
    expect(() =>
      parseDraft(
        changeField(source, ['rules', 'impossibleTravel', 'maxCandidates'], numericInput('0')),
        true,
      ),
    ).not.toThrow();
  });
  it('compares leaf fields using exact decimal text and presents additions and removals', () => {
    const raw = changeField(
      source,
      ['rules', 'impossibleTravel', 'maxAccuracyKm'],
      numericInput('0.12345678901234567890123456788'),
    );
    const changes = policyChanges(parseDraft(source), raw);
    expect(changes).toEqual([
      {
        path: 'rules.impossibleTravel.maxAccuracyKm',
        before: precision,
        after: '0.12345678901234567890123456788',
      },
    ]);
    expect(
      policyChanges(parseDraft(source), changeCurrency(source, 'ZAR', true)).some(
        (change) => change.after === '(absent)',
      ),
    ).toBe(true);
  });
});

describe('policy editor workflows', () => {
  it('shares all rule, currency and timing controls with exact JSON and preserves the draft across navigation', async () => {
    const user = userEvent.setup();
    await start(user);
    await replace(user, 'High amount threshold (ZAR)', '123.0000');
    await replace(user, 'Velocity maximum transactions', '7');
    await replace(user, 'Cumulative threshold (ZAR)', '456.0000');
    await replace(user, 'Travel maximum accuracy (km)', '0.000000000000000000000001');
    await replace(user, 'Small payment maximum (ZAR)', '0.0100');
    await replace(user, 'Currency ZAR maximum amount', '9999999999999999.9999');
    await replace(user, 'Maximum event age (seconds)', '7200');
    await user.click(editor().getByText('Advanced policy JSON'));
    const jsonInput = editor().getByLabelText('Policy JSON', {
      exact: true,
    }) as HTMLTextAreaElement;
    expect(editor().getByRole('textbox', { name: 'Policy JSON' })).toBe(jsonInput);
    expect(jsonInput.labels?.[0].textContent).toBe('Policy JSON');
    const raw = jsonInput.value;
    expect(raw).toContain('0.000000000000000000000001');
    expect(raw).toContain('9999999999999999.9999');
    expect(raw).toContain('9007199254740993');
    await user.click(screen.getByRole('link', { name: 'Evaluations' }));
    await user.click(screen.getByRole('link', { name: 'Policy' }));
    expect(await screen.findByLabelText('High amount threshold (ZAR)')).toHaveValue('123.0000');
    await user.click(editor().getByText('Advanced policy JSON'));
    expect(editor().getByLabelText('Policy JSON')).toHaveValue(raw);
    expect(writes('POST')).toHaveLength(0);
    expect(writes('PUT')).toHaveLength(0);
  });
  it('validates with the real client, requires review and activates the retained bytes with If-Match', async () => {
    const user = userEvent.setup();
    await start(user);
    await replace(user, 'High amount threshold (ZAR)', '19.0000');
    expect(editor().queryByRole('button', { name: 'Activate policy' })).not.toBeInTheDocument();
    const activate = await review(user);
    const table = editor().getByRole('table');
    expect(within(table).getByText('rules.highAmount.thresholds.ZAR')).toBeInTheDocument();
    await user.click(activate);
    await editor().findByText('Policy activated.');
    expect(writes('POST')).toHaveLength(1);
    expect(writes('PUT')).toHaveLength(1);
    expect(writes('PUT')[0][1].body).toBe(writes('POST')[0][1].body);
    expect(writes('PUT')[0][1].headers).toMatchObject({ 'If-Match': '"policy-revision-1"' });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([path]) => path === '/api/v1/rules').length,
      ).toBeGreaterThan(2),
    );
  });
  it('invalidates validation and review on any edit, including advanced JSON changes', async () => {
    const user = userEvent.setup();
    await start(user);
    await review(user);
    await replace(user, 'Velocity window (seconds)', '601');
    expect(editor().queryByRole('button', { name: 'Activate policy' })).not.toBeInTheDocument();
    await review(user);
    await user.click(editor().getByText('Advanced policy JSON'));
    await replace(user, 'Policy JSON', '');
    expect(editor().queryByRole('button', { name: 'Activate policy' })).not.toBeInTheDocument();
    await user.click(editor().getByRole('button', { name: 'Read current policy' }));
    await waitFor(() =>
      expect(editor().getByRole('button', { name: 'Read current policy' })).toBeEnabled(),
    );
    expect(editor().getByLabelText('Policy JSON')).toHaveValue('');
    await user.click(editor().getByRole('button', { name: 'Validate draft' }));
    expect(
      editor()
        .getAllByRole('alert')
        .some((alert) => alert.textContent?.includes('valid JSON')),
    ).toBe(true);
    expect(writes('POST')).toHaveLength(2);
  });
  it('shows server policy validation errors without activation and permits correction', async () => {
    fetchMock.mockImplementation((path: string, options: RequestInit) =>
      path.endsWith('/validate')
        ? Promise.resolve(json('{"code":"INVALID_POLICY"}', 422))
        : defaultResponse(path, options),
    );
    const user = userEvent.setup();
    await start(user);
    await replace(user, 'Travel maximum candidates', '0');
    await user.click(editor().getByRole('button', { name: 'Validate draft' }));
    await editor().findByText('INVALID_POLICY');
    expect(writes('POST')).toHaveLength(1);
    expect(writes('PUT')).toHaveLength(0);
    expect(editor().queryByRole('button', { name: 'Review changes' })).not.toBeInTheDocument();
    expect(editor().getByLabelText('Travel maximum candidates')).toHaveValue('0');
  });
  it('keeps the draft after a stale revision and requires a fresh read, validation and review', async () => {
    fetchMock.mockImplementation((path: string, options: RequestInit) =>
      options.method === 'PUT'
        ? Promise.resolve(json('{"code":"POLICY_REVISION_MISMATCH"}', 412))
        : defaultResponse(path, options),
    );
    const user = userEvent.setup();
    await start(user);
    await replace(user, 'High amount threshold (ZAR)', '21.0000');
    await user.click(await review(user));
    await editor().findByText(/The active revision changed/);
    expect(editor().getByLabelText('High amount threshold (ZAR)')).toHaveValue('21.0000');
    expect(editor().getByRole('button', { name: 'Validate draft' })).toBeDisabled();
    revision = '3';
    await user.click(editor().getByRole('button', { name: 'Read current policy' }));
    await waitFor(() =>
      expect(editor().getByRole('button', { name: 'Validate draft' })).toBeEnabled(),
    );
    expect(editor().queryByRole('button', { name: 'Activate policy' })).not.toBeInTheDocument();
    await review(user);
    expect(
      within(editor().getByRole('region', { name: 'Policy change review' })).getByText(
        '"policy-revision-3"',
        { selector: 'dd' },
      ),
    ).toBeInTheDocument();
    expect(writes('PUT')).toHaveLength(1);
  });
  it('never retries unknown activation and explicitly compares current policy before a new workflow', async () => {
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (options.method === 'PUT') {
        activeHash = candidateHash;
        activeDocument = options.body as string;
        revision = '2';
        return Promise.reject(new TypeError('Synthetic response lost'));
      }
      return defaultResponse(path, options);
    });
    const user = userEvent.setup();
    await start(user);
    await replace(user, 'High amount threshold (ZAR)', '22.0000');
    await user.click(await review(user));
    await editor().findByText('Activation outcome unknown.');
    expect(editor().getByLabelText('High amount threshold (ZAR)')).toBeDisabled();
    expect(editor().getByRole('button', { name: 'Validate draft' })).toBeDisabled();
    expect(writes('PUT')).toHaveLength(1);
    await user.click(editor().getByRole('button', { name: 'Read current policy' }));
    await editor().findByText(/Current policy matches the attempted candidate/);
    expect(editor().getByRole('button', { name: 'Validate draft' })).toBeEnabled();
    expect(editor().queryByRole('button', { name: 'Activate policy' })).not.toBeInTheDocument();
    expect(editor().getByLabelText('High amount threshold (ZAR)')).toHaveValue('22.0000');
    expect(writes('PUT')).toHaveLength(1);
  });
  it('does not infer failure when an unknown activation read still returns the earlier revision', async () => {
    fetchMock.mockImplementation((path: string, options: RequestInit) =>
      options.method === 'PUT'
        ? Promise.reject(new TypeError('Synthetic lost request'))
        : defaultResponse(path, options),
    );
    const user = userEvent.setup();
    await start(user);
    await user.click(await review(user));
    await editor().findByText('Activation outcome unknown.');
    await user.click(editor().getByRole('button', { name: 'Read current policy' }));
    await editor().findByText(/The earlier revision is still current/);
    expect(editor().getByRole('button', { name: 'Validate draft' })).toBeEnabled();
    expect(writes('PUT')).toHaveLength(1);
  });
  it('adopts the stored acknowledgement representation when the engine reports an unchanged policy', async () => {
    fetchMock.mockImplementation((path: string, options: RequestInit) =>
      path.endsWith('/validate')
        ? Promise.resolve(json(`{"policyHash":"${originalHash}"}`))
        : path === '/api/v1/admin/policy' && options.method === 'PUT'
          ? Promise.resolve(snapshot())
          : defaultResponse(path, options),
    );
    const user = userEvent.setup();
    await start(user);
    await replace(user, 'High amount threshold (ZAR)', '25000.0000');
    await user.click(await review(user));
    await editor().findByText('Policy unchanged; revision preserved.');
    expect(editor().getByLabelText('High amount threshold (ZAR)')).toHaveValue('25000.00');
    expect(editor().getByText('"policy-revision-1"', { selector: 'dd' })).toBeInTheDocument();
  });
  it('clears draft on administrator disconnect and ignores validation results from the old credential', async () => {
    let resolveValidation!: (response: Response) => void;
    fetchMock.mockImplementation((path: string, options: RequestInit) =>
      path.endsWith('/validate')
        ? new Promise<Response>((resolve) => {
            resolveValidation = resolve;
          })
        : defaultResponse(path, options),
    );
    const user = userEvent.setup();
    await start(user);
    await replace(user, 'High amount threshold (ZAR)', '23.0000');
    await user.click(editor().getByRole('button', { name: 'Validate draft' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect administrator' }));
    await act(async () => resolveValidation(json(`{"policyHash":"${candidateHash}"}`)));
    expect(screen.queryByRole('region', { name: 'Policy editor' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Administrator API key'), 'new.administrator-policy-key');
    await user.click(screen.getByRole('button', { name: 'Connect administrator' }));
    expect(await screen.findByLabelText('High amount threshold (ZAR)')).toHaveValue('25000.00');
    expect(editor().queryByRole('button', { name: 'Review changes' })).not.toBeInTheDocument();
  });
  it('updates forms from advanced JSON and adds a currency with no invented thresholds', async () => {
    const user = userEvent.setup();
    await start(user);
    await user.click(editor().getByText('Advanced policy JSON'));
    const raw = changeField(
      source,
      ['rules', 'impossibleTravel', 'maxAccuracyKm'],
      numericInput('0.99999999999999999999999999999'),
    );
    fireEvent.change(editor().getByLabelText('Policy JSON'), { target: { value: raw } });
    expect(editor().getByLabelText('Travel maximum accuracy (km)')).toHaveValue(
      '0.99999999999999999999999999999',
    );
    await user.type(editor().getByLabelText('New currency code'), 'usd');
    await user.click(editor().getByRole('button', { name: 'Add currency' }));
    expect(editor().getByLabelText('Currency USD scale')).toHaveValue('');
    expect(editor().getByLabelText('High amount threshold (USD)')).toHaveValue('');
    expect(editor().getByLabelText('Cumulative threshold (USD)')).toHaveValue('');
    expect(editor().getByLabelText('Small payment maximum (USD)')).toHaveValue('');
    expect(editor().getByLabelText('Large payment threshold (USD)')).toHaveValue('');
    await user.click(editor().getByRole('button', { name: 'Validate draft' }));
    expect(editor().getByRole('alert')).toHaveTextContent(
      'supportedCurrencies.USD.scale must be a JSON number',
    );
    expect(writes('POST')).toHaveLength(0);
    await user.click(editor().getByRole('button', { name: 'Remove currency USD' }));
    expect(editor().queryByLabelText('Currency USD scale')).not.toBeInTheDocument();
  });
  it('abandons a pending validation on navigation and ignores its late result without losing the draft', async () => {
    let resolveValidation!: (response: Response) => void;
    fetchMock.mockImplementation((path: string, options: RequestInit) =>
      path.endsWith('/validate')
        ? new Promise<Response>((resolve) => {
            resolveValidation = resolve;
          })
        : defaultResponse(path, options),
    );
    const user = userEvent.setup();
    await start(user);
    await replace(user, 'High amount threshold (ZAR)', '24.0000');
    await user.click(editor().getByRole('button', { name: 'Validate draft' }));
    await user.click(screen.getByRole('link', { name: 'Evaluations' }));
    await act(async () => resolveValidation(json(`{"policyHash":"${candidateHash}"}`)));
    await user.click(screen.getByRole('link', { name: 'Policy' }));
    expect(await screen.findByLabelText('High amount threshold (ZAR)')).toHaveValue('24.0000');
    expect(editor().queryByRole('button', { name: 'Review changes' })).not.toBeInTheDocument();
    expect(editor().getByRole('button', { name: 'Validate draft' })).toBeEnabled();
    expect(writes('PUT')).toHaveLength(0);
  });
  it('treats navigation during activation as uncertain even if the old response completes later', async () => {
    let resolveActivation!: (response: Response) => void;
    fetchMock.mockImplementation((path: string, options: RequestInit) =>
      options.method === 'PUT'
        ? new Promise<Response>((resolve) => {
            resolveActivation = resolve;
          })
        : defaultResponse(path, options),
    );
    const user = userEvent.setup();
    await start(user);
    await replace(user, 'High amount threshold (ZAR)', '25.0000');
    await user.click(await review(user));
    await user.click(screen.getByRole('link', { name: 'Evaluations' }));
    await act(async () => resolveActivation(snapshot(source, candidateHash, '2')));
    await user.click(screen.getByRole('link', { name: 'Policy' }));
    await editor().findByText('Activation outcome unknown.');
    expect(editor().getByLabelText('High amount threshold (ZAR)')).toHaveValue('25.0000');
    expect(editor().getByRole('button', { name: 'Validate draft' })).toBeDisabled();
    expect(writes('PUT')).toHaveLength(1);
  });
  it('clears administrator state when validation discovers a revoked credential', async () => {
    fetchMock.mockImplementation((path: string, options: RequestInit) =>
      path.endsWith('/validate')
        ? Promise.resolve(json('{"code":"UNAUTHORIZED"}', 401))
        : defaultResponse(path, options),
    );
    const user = userEvent.setup();
    await start(user);
    await replace(user, 'High amount threshold (ZAR)', '26.0000');
    await user.click(editor().getByRole('button', { name: 'Validate draft' }));
    await screen.findByLabelText('Administrator API key');
    expect(screen.queryByRole('region', { name: 'Policy editor' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(writes('PUT')).toHaveLength(0);
  });
  it('refuses an administrator snapshot without its revision ETag and never offers activation', async () => {
    let reads = 0;
    fetchMock.mockImplementation((path: string, options: RequestInit) => {
      if (path === '/api/v1/admin/policy' && ++reads === 2)
        return Promise.resolve(
          json(`{"revision":1,"policyHash":"${originalHash}","document":${source}}`),
        );
      return defaultResponse(path, options);
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('API key', { exact: true }), 'ordinary.policy-test-key');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByLabelText('Administrator API key');
    await user.type(
      screen.getByLabelText('Administrator API key'),
      'administrator.policy-test-key',
    );
    await user.click(screen.getByRole('button', { name: 'Connect administrator' }));
    await screen.findByText('INVALID_RESPONSE');
    expect(editor().queryByRole('button', { name: 'Validate draft' })).not.toBeInTheDocument();
    expect(editor().queryByRole('button', { name: 'Activate policy' })).not.toBeInTheDocument();
    expect(writes('PUT')).toHaveLength(0);
    await user.click(editor().getByRole('button', { name: 'Read current policy' }));
    expect(await screen.findByLabelText('High amount threshold (ZAR)')).toHaveValue('25000.00');
  });
});
