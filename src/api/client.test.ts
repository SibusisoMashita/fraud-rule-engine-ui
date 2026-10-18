import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLosslessNumber } from 'lossless-json';
import {
  ApiError,
  createApiClient,
  displayValue,
  prettyJson,
  type EvaluationFilters,
} from './client';

const key = 'test-key.synthetic-secret';
const rulesJson = '{"rules":[],"policyHash":"hash"}';
const transactionJson =
  '{"transaction":{"eventId":"evt-1","customerId":"customer-1","instrumentId":"card-1","transactionType":"CARD_PURCHASE","status":"BOOKED","channel":"CARD_PRESENT","amount":"9999999999999999.9999","currency":"ZAR","category":"OTHER","occurredAt":"2026-10-18T12:00:00Z","physicalLocation":{"latitude":-33.9249,"longitude":18.4241,"accuracyKm":0.12345678901234567890123456789,"source":"VERIFIED_CARD_PRESENT_TERMINAL"}},"evaluation":{"id":"evaluation-1","eventId":"evt-1","decision":"FLAGGED","coverage":"COMPLETE","policyHash":"hash","buildId":"test","acceptedAt":"2026-10-18T12:00:00Z","evaluatedAt":"2026-10-18T12:00:00Z","contextHighWatermark":9007199254740993,"ruleResults":[{"ruleId":"IMPOSSIBLE_TRAVEL","algorithmVersion":"1","status":"MATCH","reasonCode":"TRAVEL_TOO_FAST","evidence":{"distanceKm":1234.5678901234567890123456789}}]}}';
let fetchMock: ReturnType<typeof vi.fn>;

function response(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('lossless API data', () => {
  it('preserves long decimals, large integers and monetary strings in nested evidence', async () => {
    const raw = transactionJson;
    fetchMock.mockResolvedValue(response(raw));

    const result = await createApiClient(key).getTransaction('evt-1');
    expect(result.raw).toBe(raw);
    expect(result.data.transaction.amount).toBe('9999999999999999.9999');
    expect(isLosslessNumber(result.data.transaction.physicalLocation?.accuracyKm)).toBe(true);
    expect(displayValue(result.data.transaction.physicalLocation?.accuracyKm)).toBe(
      '0.12345678901234567890123456789',
    );
    expect(displayValue(result.data.evaluation.contextHighWatermark)).toBe('9007199254740993');
    expect(displayValue(result.data.evaluation.ruleResults[0].evidence.distanceKm)).toBe(
      '1234.5678901234567890123456789',
    );
    expect(prettyJson(result.raw)).toContain('0.12345678901234567890123456789');
    expect(prettyJson(result.data)).toContain('9007199254740993');
  });

  it('keeps administrator revision and ETag exact', async () => {
    fetchMock.mockResolvedValue(
      response('{"revision":9223372036854775807,"policyHash":"hash","document":{}}', 200, {
        ETag: '"policy-revision-9223372036854775807"',
      }),
    );
    const result = await createApiClient(key).getEditablePolicy();
    expect(displayValue(result.data.revision)).toBe('9223372036854775807');
    expect(result.etag).toBe('"policy-revision-9223372036854775807"');
  });

  it('formats exact JSON without converting numeric-looking strings', () => {
    expect(
      prettyJson('{"amount":"100.00","threshold":100.000000000000000000001,"enabled":false}'),
    ).toBe(
      '{\n  "amount": "100.00",\n  "threshold": 100.000000000000000000001,\n  "enabled": false\n}',
    );
    expect(displayValue(false)).toBe('false');
    expect(displayValue(undefined)).toBe('—');
    expect(displayValue('001.00')).toBe('001.00');
    expect(prettyJson('not JSON')).toBe('not JSON');
  });

  it.each(['not JSON', 'null', '[]'])(
    'rejects an unreadable successful response: %s',
    async (body) => {
      fetchMock.mockResolvedValue(response(body));
      await expect(createApiClient(key).getRules()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    },
  );

  it.each([
    ['getRules', '{"policyHash":"hash","rules":[null]}'],
    ['getEvaluations', '{"items":[{"ruleResults":null}]}'],
    ['getTransaction', '{"transaction":{},"evaluation":{}}'],
    ['getEditablePolicy', '{"policyHash":"hash","revision":1,"document":null}'],
  ] as const)('rejects an unsafe %s shape before the view can render it', async (method, raw) => {
    fetchMock.mockResolvedValue(response(raw));
    const client = createApiClient(key);
    const result = method === 'getTransaction' ? client[method]('evt-1') : client[method]();
    await expect(result).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('fixed API routes and request safety', () => {
  it('uses same-origin GET requests without browser credentials or caching', async () => {
    fetchMock.mockResolvedValue(response('{"rules":[],"policyHash":"hash"}'));
    const signal = new AbortController().signal;
    await createApiClient(key).getRules(signal);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/rules', {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-API-Key': key },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
  });

  it('preserves all explicit filters when fetching the next cursor page', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response('{"items":[]}')));
    const filters: EvaluationFilters = {
      customerId: 'customer:one',
      decision: 'FLAGGED',
      acceptedFrom: '2026-10-18T10:00:00Z',
      acceptedTo: '2026-10-18T11:00:00Z',
      pageSize: 25,
    };
    const client = createApiClient(key);
    await client.getEvaluations(filters);
    await client.getEvaluations({ ...filters, cursor: 'opaque+cursor/==' });
    const first = new URL(fetchMock.mock.calls[0][0] as string, 'http://localhost');
    const next = new URL(fetchMock.mock.calls[1][0] as string, 'http://localhost');
    expect(next.searchParams.get('cursor')).toBe('opaque+cursor/==');
    next.searchParams.delete('cursor');
    expect(next.search).toBe(first.search);
    expect([...next.searchParams.keys()]).toEqual([
      'customerId',
      'decision',
      'acceptedFrom',
      'acceptedTo',
      'pageSize',
    ]);
  });

  it('does not emit empty, duplicate or unknown query parameters', async () => {
    fetchMock.mockResolvedValue(response('{"items":[]}'));
    await createApiClient(key).getEvaluations({
      customerId: '',
      cursor: '',
      pageSize: 10,
      apiKey: key,
    } as EvaluationFilters);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/evaluations?pageSize=10');
  });

  it('does not append an empty query and encodes an event identifier as one path segment', async () => {
    fetchMock
      .mockResolvedValueOnce(response('{"items":[]}'))
      .mockResolvedValue(response(transactionJson));
    const client = createApiClient(key);
    await client.getEvaluations();
    await client.getTransaction('evt:one?other=value');
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/evaluations',
      '/api/v1/transactions/evt%3Aone%3Fother%3Dvalue',
    ]);
  });
});

describe('errors, permissions and cancellation', () => {
  it('clears the caller session on 401 even if the error body is unreadable', async () => {
    const onUnauthorized = vi.fn();
    fetchMock.mockResolvedValue(response('upstream error', 401));
    await expect(createApiClient(key, { onUnauthorized }).getRules()).rejects.toMatchObject({
      status: 401,
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('keeps a valid session on permission denial and exposes safe diagnostic identifiers', async () => {
    const onUnauthorized = vi.fn();
    fetchMock.mockResolvedValue(
      response(
        '{"code":"FORBIDDEN","correlationId":"test-correlation","detail":"secret content"}',
        403,
      ),
    );
    const error = await createApiClient(key, { onUnauthorized })
      .getEditablePolicy()
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      correlationId: 'test-correlation',
    });
    expect((error as ApiError).message).not.toContain('secret content');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not echo unsafe server messages, error codes or correlation identifiers', async () => {
    fetchMock.mockResolvedValue(
      response(
        JSON.stringify({
          title: key,
          detail: key,
          code: `error ${key}`,
          correlationId: `https://example.test/?key=${key}`,
        }),
        500,
        { 'X-Correlation-ID': 'safe-request-id' },
      ),
    );
    const error = await createApiClient(key)
      .getRules()
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'REQUEST_FAILED', correlationId: 'safe-request-id' });
    expect(String(error)).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain(key);
  });

  it('uses a fixed network error and never automatically retries', async () => {
    fetchMock.mockRejectedValue(new TypeError(`Failed to fetch https://example.test/${key}`));
    const error = await createApiClient(key)
      .getRules()
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_UNAVAILABLE' });
    expect(String(error)).not.toContain(key);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not send an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createApiClient(key).getRules(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves cancellation instead of presenting it as a service failure', async () => {
    fetchMock.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    await expect(createApiClient(key).getRules(new AbortController().signal)).rejects.toMatchObject(
      { name: 'AbortError' },
    );
  });
});

describe('Retry-After', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
  });

  it('blocks further requests until Retry-After seconds elapse, without scheduling retries', async () => {
    const onRateLimit = vi.fn();
    const retryAt = Date.now() + 5000;
    fetchMock
      .mockResolvedValueOnce(response('{"code":"RATE_LIMITED"}', 429, { 'Retry-After': '5' }))
      .mockResolvedValue(response(rulesJson));
    const client = createApiClient(key, { onRateLimit });
    await expect(client.getRules()).rejects.toMatchObject({ status: 429, retryAt });
    await expect(client.getEvaluations()).rejects.toMatchObject({ status: 429, retryAt });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(retryAt);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledOnce();
    await client.getRules();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts an HTTP date and keeps cooldowns separate for distinct connections', async () => {
    const retryAt = Date.now() + 10000;
    fetchMock
      .mockResolvedValueOnce(
        response('{}', 429, { 'Retry-After': new Date(retryAt).toUTCString() }),
      )
      .mockResolvedValue(response(rulesJson));
    const limited = createApiClient(key);
    await expect(limited.getRules()).rejects.toMatchObject({ retryAt });
    await createApiClient('other-key').getRules();
    await expect(limited.getRules()).rejects.toMatchObject({ retryAt });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('also respects a dependency-unavailable Retry-After', async () => {
    fetchMock.mockResolvedValue(response('{}', 503, { 'Retry-After': '2' }));
    const client = createApiClient(key);
    await expect(client.getRules()).rejects.toMatchObject({
      status: 503,
      retryAt: Date.now() + 2000,
    });
    await expect(client.getRules()).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(['invalid', '-1', 'Sun, 18 Oct 2026 11:00:00 GMT'])(
    'does not invent a future cooldown for %s',
    async (header) => {
      fetchMock
        .mockResolvedValueOnce(response('{}', 429, { 'Retry-After': header }))
        .mockResolvedValue(response(rulesJson));
      const client = createApiClient(key);
      await expect(client.getRules()).rejects.toMatchObject({ retryAt: undefined });
      await client.getRules();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
});
