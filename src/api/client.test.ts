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
const submittedJson = `{
  "eventId":"evt-1", "customerId":"customer-1", "instrumentId":"card-1",
  "transactionType":"CARD_PURCHASE", "status":"BOOKED", "channel":"CARD_PRESENT",
  "amount":"9999999999999999.9999", "currency":"ZAR", "category":"OTHER",
  "occurredAt":"2026-10-18T12:00:00Z",
  "physicalLocation":{"latitude":-33.924900,"longitude":18.424100,
    "accuracyKm":0.12345678901234567890123456789,"source":"VERIFIED_CARD_PRESENT_TERMINAL"}
}`;
const policyHash = 'a'.repeat(64);
const policyDocumentJson = `{
  "schemaVersion":1,"canonicalizationVersion":1,
  "supportedCurrencies":{"ZAR":{"scale":2,"maxAmount":"1000000.00"}},
  "ingest":{"maxEventAgeSeconds":86400,"maxFutureSkewSeconds":300},
  "rules":{
    "highAmount":{"enabled":true,"thresholds":{"ZAR":"25000.00"}},
    "transactionVelocity":{"enabled":true,"windowSeconds":300,"maxTransactions":5},
    "cumulativeSpend":{"enabled":true,"windowSeconds":3600,"thresholds":{"ZAR":"30000.00"}},
    "impossibleTravel":{"enabled":true,"maxComparisonAgeSeconds":86400,"maxCandidates":100,
      "maxSpeedKmh":900.00,"minDistanceKm":100,"travelAllowanceKm":20,
      "maxAccuracyKm":0.12345678901234567890123456789,
      "trustedSources":["VERIFIED_CARD_PRESENT_TERMINAL"],"eligibleChannels":["CARD_PRESENT"]},
    "smallPaymentBurstThenLarge":{"enabled":true,"windowSeconds":300,"minSmallPayments":3,
      "smallPaymentMaximum":{"ZAR":"50.00"},"largePaymentThreshold":{"ZAR":"5000.00"}}
  }
}`;

function policySnapshotJson(revision = '1') {
  return `{"revision":${revision},"policyHash":"${policyHash}","document":${policyDocumentJson}}`;
}
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
    expect(result.status).toBe(200);
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
      response(policySnapshotJson('9223372036854775807'), 200, {
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
  it('clears the caller session when reading a known HTTP 401 response body fails', async () => {
    const onUnauthorized = vi.fn();
    const received = response('{}', 401, { 'X-Correlation-ID': 'interrupted-read-test' });
    vi.spyOn(received, 'text').mockRejectedValue(new TypeError('Synthetic interrupted error body'));
    fetchMock.mockResolvedValue(received);
    await expect(createApiClient(key, { onUnauthorized }).getRules()).rejects.toMatchObject({
      status: 401,
      correlationId: 'interrupted-read-test',
      outcome: undefined,
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

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

describe('transaction submission', () => {
  it.each([201, 200])(
    'posts the original JSON untouched and returns the %s result with exact evidence',
    async (status) => {
      fetchMock.mockResolvedValue(response(transactionJson, status));
      const signal = new AbortController().signal;
      const result = await createApiClient(key).submitTransaction(submittedJson, signal);
      expect(result.status).toBe(status);
      expect(result.raw).toBe(transactionJson);
      expect(displayValue(result.data.transaction.physicalLocation?.accuracyKm)).toBe(
        '0.12345678901234567890123456789',
      );
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/transactions', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'X-API-Key': key,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal,
        body: submittedJson,
      });
    },
  );

  it.each([400, 401, 403, 409, 413, 415, 422, 429])(
    'treats an explicit HTTP %s as a rejected attempt',
    async (status) => {
      const onUnauthorized = vi.fn();
      fetchMock.mockResolvedValue(
        response('{"code":"REQUEST_REJECTED","correlationId":"submission-reference"}', status),
      );
      const failure = await createApiClient(key, { onUnauthorized })
        .submitTransaction(submittedJson)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect(failure).toMatchObject({
        status,
        outcome: 'REJECTED',
        code: 'REQUEST_REJECTED',
        correlationId: 'submission-reference',
      });
      expect(onUnauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      expect(String(failure)).not.toContain(key);
      expect(String(failure)).not.toContain(submittedJson);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it.each([500, 502, 503, 504])(
    'preserves uncertainty for HTTP %s even if its body claims not accepted',
    async (status) => {
      fetchMock.mockResolvedValue(
        response('{"code":"DEPENDENCY_UNAVAILABLE","outcome":"NOT_ACCEPTED"}', status),
      );
      const failure = await createApiClient(key)
        .submitTransaction(submittedJson)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ status, outcome: 'UNKNOWN' });
      expect(String(failure)).toMatch(/retrieve.*same event ID and exact payload/i);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['EVENT_CONTENT_CONFLICT', /event ID.*different content/i],
    ['INSTRUMENT_OWNER_CONFLICT', /instrument.*another customer/i],
    ['UNRECOGNIZED_CONFLICT', /conflicts with stored data/i],
  ] as const)('explains HTTP 409 using its safe %s code', async (code, message) => {
    fetchMock.mockResolvedValue(response(JSON.stringify({ code }), 409));
    const failure = await createApiClient(key)
      .submitTransaction(submittedJson)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 409, code, outcome: 'REJECTED' });
    expect(String(failure)).toMatch(message);
    if (code !== 'EVENT_CONTENT_CONFLICT')
      expect(String(failure)).not.toMatch(/event ID.*different content/i);
  });

  it.each(['not JSON', '{}'])(
    'treats an unreadable successful response as an uncertain commit: %s',
    async (body) => {
      fetchMock.mockResolvedValue(response(body, 201));
      await expect(createApiClient(key).submitTransaction(submittedJson)).rejects.toMatchObject({
        status: 201,
        code: 'INVALID_RESPONSE',
        outcome: 'UNKNOWN',
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('does not claim a committed result for an unexpected 202 with an otherwise valid resource', async () => {
    fetchMock.mockResolvedValue(response(transactionJson, 202));
    await expect(createApiClient(key).submitTransaction(submittedJson)).rejects.toMatchObject({
      status: 202,
      code: 'INVALID_RESPONSE',
      outcome: 'UNKNOWN',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps network failures private and uncertain without retrying', async () => {
    fetchMock.mockRejectedValue(
      new TypeError(`Failed to fetch https://example.test/${key}?payload=${submittedJson}`),
    );
    const failure = await createApiClient(key)
      .submitTransaction(submittedJson)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      status: 0,
      code: 'SUBMISSION_OUTCOME_UNKNOWN',
      outcome: 'UNKNOWN',
    });
    expect(String(failure)).not.toContain(key);
    expect(JSON.stringify(failure)).not.toContain('customer-1');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('treats a response-body failure as uncertain after receiving a success status', async () => {
    const received = response(transactionJson, 201);
    vi.spyOn(received, 'text').mockRejectedValue(new TypeError('Synthetic interrupted response'));
    fetchMock.mockResolvedValue(received);
    await expect(createApiClient(key).submitTransaction(submittedJson)).rejects.toMatchObject({
      status: 201,
      code: 'SUBMISSION_OUTCOME_UNKNOWN',
      outcome: 'UNKNOWN',
    });
  });

  it('retains the authentication callback when reading a rejected response fails', async () => {
    const onUnauthorized = vi.fn();
    const received = response('{}', 401);
    vi.spyOn(received, 'text').mockRejectedValue(new TypeError('Synthetic interrupted response'));
    fetchMock.mockResolvedValue(received);
    await expect(
      createApiClient(key, { onUnauthorized }).submitTransaction(submittedJson),
    ).rejects.toMatchObject({
      status: 401,
      outcome: 'REJECTED',
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it.each([403, 409, 429])(
    'treats an interrupted HTTP %s error body as a rejected attempt',
    async (status) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
      const onUnauthorized = vi.fn();
      const onRateLimit = vi.fn();
      const received = response('{}', status, {
        'Retry-After': '3',
        'X-Correlation-ID': 'interrupted-error-test',
      });
      vi.spyOn(received, 'text').mockRejectedValue(
        new TypeError(`Synthetic interrupted body ${key}`),
      );
      fetchMock.mockResolvedValue(received);
      const client = createApiClient(key, { onUnauthorized, onRateLimit });
      const failure = await client
        .submitTransaction(submittedJson)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        status,
        outcome: 'REJECTED',
        correlationId: 'interrupted-error-test',
        retryAt: Date.now() + 3000,
      });
      expect(String(failure)).not.toContain(key);
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(Date.now() + 3000);
      await expect(client.submitTransaction(submittedJson)).rejects.toMatchObject({
        status,
        outcome: undefined,
      });
      await vi.advanceTimersByTimeAsync(3000);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('preserves uncertainty when a dispatched request is cancelled', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_path: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const result = createApiClient(key).submitTransaction(submittedJson, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ status: 0, outcome: 'UNKNOWN' });
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('leaves an already cancelled attempt without an outcome because nothing was dispatched', async () => {
    const controller = new AbortController();
    controller.abort();
    const failure = await createApiClient(key)
      .submitTransaction(submittedJson, controller.signal)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: 'AbortError' });
    expect(failure).not.toHaveProperty('outcome');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps local cooldown errors outcome-free and requires an explicit identical replay after recovery', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    fetchMock
      .mockResolvedValueOnce(response('{}', 503, { 'Retry-After': '2' }))
      .mockResolvedValue(response(transactionJson, 200));
    const client = createApiClient(key);
    await expect(client.submitTransaction(submittedJson)).rejects.toMatchObject({
      outcome: 'UNKNOWN',
    });
    const blocked = await client.submitTransaction(submittedJson).catch((error: unknown) => error);
    expect(blocked).toMatchObject({ status: 503, retryAt: Date.now() + 2000 });
    expect((blocked as ApiError).outcome).toBeUndefined();
    expect(String(blocked)).toMatch(/not sent/i);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledOnce();
    const replay = await client.submitTransaction(submittedJson);
    expect(replay.status).toBe(200);
    expect(fetchMock.mock.calls.map(([, options]) => options.body)).toEqual([
      submittedJson,
      submittedJson,
    ]);
  });

  it('respects Retry-After even when a failure body cannot be read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    const onRateLimit = vi.fn();
    const received = response('{}', 503, { 'Retry-After': '3' });
    vi.spyOn(received, 'text').mockRejectedValue(new TypeError('Synthetic interrupted response'));
    fetchMock.mockResolvedValue(received);
    const client = createApiClient(key, { onRateLimit });
    await expect(client.submitTransaction(submittedJson)).rejects.toMatchObject({
      outcome: 'UNKNOWN',
      retryAt: Date.now() + 3000,
    });
    expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(Date.now() + 3000);
    await expect(client.getRules()).rejects.toMatchObject({ status: 503, outcome: undefined });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('policy administration', () => {
  it('validates exact policy JSON without mutation semantics or an activation precondition', async () => {
    fetchMock.mockResolvedValue(response(`{"policyHash":"${policyHash}"}`));
    const signal = new AbortController().signal;
    const result = await createApiClient(key).validatePolicy(policyDocumentJson, signal);
    expect(result).toMatchObject({ status: 200, data: { policyHash } });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/admin/policy/validate', {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-API-Key': key, 'Content-Type': 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
      body: policyDocumentJson,
    });
  });

  it.each([400, 403, 422, 503])(
    'does not report an unknown activation when validation returns HTTP %s',
    async (status) => {
      fetchMock.mockResolvedValue(response('{"code":"POLICY_INVALID"}', status));
      const failure = await createApiClient(key)
        .validatePolicy(policyDocumentJson)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ status, outcome: undefined });
      expect(String(failure)).not.toMatch(/activation outcome is unknown/i);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('does not treat a validation network failure or cancellation as a possible activation', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError(`Synthetic network failure ${key}`))
      .mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
    const client = createApiClient(key);
    await expect(client.validatePolicy(policyDocumentJson)).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
      outcome: undefined,
    });
    await expect(
      client.validatePolicy(policyDocumentJson, new AbortController().signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['{"policyHash":"invalid"}', 200],
    ['{}', 200],
    [`{"policyHash":"${policyHash}"}`, 201],
  ] as const)(
    'rejects an invalid validation response without mutation uncertainty',
    async (raw, status) => {
      fetchMock.mockResolvedValue(response(raw, status));
      await expect(createApiClient(key).validatePolicy(policyDocumentJson)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        outcome: undefined,
      });
    },
  );

  it('activates the exact document with its strong If-Match revision and preserves precise returned values', async () => {
    const revision = '9007199254740993';
    const etag = `"policy-revision-${revision}"`;
    const signal = new AbortController().signal;
    fetchMock.mockResolvedValue(response(policySnapshotJson(revision), 200, { ETag: etag }));
    const result = await createApiClient(key).activatePolicy(policyDocumentJson, etag, signal);
    expect(result.status).toBe(200);
    expect(result.etag).toBe(etag);
    expect(displayValue(result.data.revision)).toBe(revision);
    expect(displayValue(result.data.document.rules.impossibleTravel.maxAccuracyKm)).toBe(
      '0.12345678901234567890123456789',
    );
    expect(result.data.document.rules.highAmount.thresholds.ZAR).toBe('25000.00');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/admin/policy', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'X-API-Key': key,
        'Content-Type': 'application/json',
        'If-Match': etag,
      },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
      body: policyDocumentJson,
    });
  });

  it.each([
    '',
    '*',
    'W/"policy-revision-1"',
    '"policy-revision-1", "policy-revision-2"',
    '"policy-revision-0"',
    '"policy-revision-01"',
    '"policy-revision-1.0"',
    '"policy-revision-9223372036854775808"',
  ])('does not dispatch activation with invalid precondition %s', async (etag) => {
    await expect(
      createApiClient(key).activatePolicy(policyDocumentJson, etag),
    ).rejects.toMatchObject({ code: 'INVALID_POLICY_ETAG', outcome: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [412, /active policy changed.*keep your draft/i],
    [428, /requires the current policy revision.*reload/i],
  ] as const)(
    'explains HTTP %s activation preconditions without losing their rejection status',
    async (status, message) => {
      fetchMock.mockResolvedValue(response('{}', status));
      const failure = await createApiClient(key)
        .activatePolicy(policyDocumentJson, '"policy-revision-1"')
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ status, outcome: 'REJECTED' });
      expect(String(failure)).toMatch(message);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it.each([500, 503])(
    'keeps HTTP %s activation failures uncertain with policy-specific recovery guidance',
    async (status) => {
      fetchMock.mockResolvedValue(
        response('{"code":"DEPENDENCY_UNAVAILABLE","outcome":"NOT_ACCEPTED"}', status),
      );
      const failure = await createApiClient(key)
        .activatePolicy(policyDocumentJson, '"policy-revision-1"')
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ status, code: 'POLICY_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' });
      expect(String(failure)).toMatch(/read the active policy.*revision and hash/i);
      expect(String(failure)).not.toMatch(/transaction.*replay/i);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    'not JSON',
    '{}',
    policySnapshotJson('0'),
    policySnapshotJson('1.5'),
    policySnapshotJson('1e3'),
    policySnapshotJson('9223372036854775808'),
  ])('does not certify an unreadable activation result or invalid exact revision', async (raw) => {
    fetchMock.mockResolvedValue(response(raw, 200, { ETag: '"policy-revision-1"' }));
    await expect(
      createApiClient(key).activatePolicy(policyDocumentJson, '"policy-revision-1"'),
    ).rejects.toMatchObject({ code: 'POLICY_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' });
  });

  it.each([undefined, 'W/"policy-revision-1"', '"policy-revision-2"'])(
    'rejects a policy snapshot with missing, weak or mismatched ETag: %s',
    async (etag) => {
      fetchMock.mockResolvedValue(
        response(policySnapshotJson(), 200, etag === undefined ? {} : { ETag: etag }),
      );
      await expect(createApiClient(key).getEditablePolicy()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        outcome: undefined,
      });
    },
  );

  it('does not certify an activation with a missing returned ETag or unexpected success status', async () => {
    fetchMock
      .mockResolvedValueOnce(response(policySnapshotJson()))
      .mockResolvedValueOnce(response(policySnapshotJson(), 202, { ETag: '"policy-revision-1"' }));
    const client = createApiClient(key);
    await expect(
      client.activatePolicy(policyDocumentJson, '"policy-revision-1"'),
    ).rejects.toMatchObject({ code: 'POLICY_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' });
    await expect(
      client.activatePolicy(policyDocumentJson, '"policy-revision-1"'),
    ).rejects.toMatchObject({ status: 202, outcome: 'UNKNOWN' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps activation network and successful-response-body failures uncertain without leaking diagnostics', async () => {
    const received = response(policySnapshotJson(), 200, { ETag: '"policy-revision-1"' });
    vi.spyOn(received, 'text').mockRejectedValue(new TypeError('Synthetic incomplete response'));
    fetchMock
      .mockRejectedValueOnce(new TypeError(`Synthetic failed URL https://example.test/${key}`))
      .mockResolvedValueOnce(received);
    const client = createApiClient(key);
    for (let attempt = 0; attempt < 2; attempt++) {
      const failure = await client
        .activatePolicy(policyDocumentJson, '"policy-revision-1"')
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'POLICY_OUTCOME_UNKNOWN', outcome: 'UNKNOWN' });
      expect(String(failure)).not.toContain(key);
      expect(JSON.stringify(failure)).not.toContain('maxAccuracyKm');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('distinguishes pre-dispatch activation cancellation from cancellation after dispatch', async () => {
    const before = new AbortController();
    before.abort();
    const client = createApiClient(key);
    await expect(
      client.activatePolicy(policyDocumentJson, '"policy-revision-1"', before.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    const after = new AbortController();
    fetchMock.mockImplementation(
      (_path: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const activation = client.activatePolicy(
      policyDocumentJson,
      '"policy-revision-1"',
      after.signal,
    );
    const assertion = expect(activation).rejects.toMatchObject({
      code: 'POLICY_OUTCOME_UNKNOWN',
      outcome: 'UNKNOWN',
    });
    after.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves authentication callbacks and known rejection headers despite an interrupted activation error body', async () => {
    const onUnauthorized = vi.fn();
    const received = response('{}', 401, { 'X-Correlation-ID': 'policy-denied-test' });
    vi.spyOn(received, 'text').mockRejectedValue(new TypeError('Synthetic interrupted error'));
    fetchMock.mockResolvedValue(received);
    await expect(
      createApiClient(key, { onUnauthorized }).activatePolicy(
        policyDocumentJson,
        '"policy-revision-1"',
      ),
    ).rejects.toMatchObject({
      status: 401,
      outcome: 'REJECTED',
      correlationId: 'policy-denied-test',
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('respects policy Retry-After without retrying or labelling a locally blocked request as an activation attempt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    const onRateLimit = vi.fn();
    fetchMock.mockResolvedValue(response('{}', 503, { 'Retry-After': '2' }));
    const client = createApiClient(key, { onRateLimit });
    await expect(
      client.activatePolicy(policyDocumentJson, '"policy-revision-1"'),
    ).rejects.toMatchObject({ outcome: 'UNKNOWN', retryAt: Date.now() + 2000 });
    await expect(
      client.activatePolicy(policyDocumentJson, '"policy-revision-1"'),
    ).rejects.toMatchObject({ outcome: undefined });
    expect(onRateLimit).toHaveBeenCalledExactlyOnceWith(Date.now() + 2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledOnce();
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
