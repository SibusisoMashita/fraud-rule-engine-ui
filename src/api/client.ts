import { isLosslessNumber, parse, stringify, type LosslessNumber } from 'lossless-json';
import type { components, operations } from './generated';

/** API numbers retain their JSON decimal text, including integers beyond Number.MAX_SAFE_INTEGER. */
export type Exact<T> = T extends number
  ? LosslessNumber
  : T extends Array<infer Item>
    ? Array<Exact<Item>>
    : T extends object
      ? { [Key in keyof T]: Exact<T[Key]> }
      : T;

export type Evaluation = Exact<components['schemas']['Evaluation']>;
export type EvaluationPage = Exact<components['schemas']['EvaluationPage']>;
export type TransactionResource = Exact<components['schemas']['TransactionResource']>;
export type RulesView = Exact<components['schemas']['RulesView']>;
export type EditablePolicy = Exact<components['schemas']['EditablePolicy']>;
export type EvaluationFilters = NonNullable<operations['listEvaluations']['parameters']['query']>;

export interface ApiResponse<T> {
  data: T;
  raw: string;
  etag?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId?: string;
  readonly retryAt?: number;

  constructor(
    message: string,
    details: { status: number; code: string; correlationId?: string; retryAt?: number },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = details.status;
    this.code = details.code;
    this.correlationId = details.correlationId;
    this.retryAt = details.retryAt;
  }
}

interface ClientOptions {
  onUnauthorized?: () => void;
  onRateLimit?: (retryAt: number) => void;
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !isLosslessNumber(value)
  );
}

function strings(value: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === 'string');
}

function ruleResult(value: unknown): boolean {
  return (
    record(value) &&
    strings(value, 'ruleId', 'algorithmVersion', 'status', 'reasonCode') &&
    record(value.evidence) &&
    Object.values(value.evidence).every(
      (fact) => typeof fact === 'string' || typeof fact === 'boolean' || isLosslessNumber(fact),
    )
  );
}

function evaluation(value: unknown): boolean {
  return (
    record(value) &&
    strings(
      value,
      'id',
      'eventId',
      'decision',
      'coverage',
      'policyHash',
      'buildId',
      'acceptedAt',
      'evaluatedAt',
    ) &&
    isLosslessNumber(value.contextHighWatermark) &&
    Array.isArray(value.ruleResults) &&
    value.ruleResults.every(ruleResult)
  );
}

function evaluationPage(value: unknown): boolean {
  return (
    record(value) &&
    Array.isArray(value.items) &&
    value.items.every(evaluation) &&
    (value.nextCursor === undefined || typeof value.nextCursor === 'string')
  );
}

function transactionResource(value: unknown): boolean {
  if (!record(value) || !record(value.transaction) || !evaluation(value.evaluation)) return false;
  const transaction = value.transaction;
  if (
    !strings(
      transaction,
      'eventId',
      'customerId',
      'instrumentId',
      'transactionType',
      'status',
      'channel',
      'amount',
      'currency',
      'category',
      'occurredAt',
    )
  )
    return false;
  const location = transaction.physicalLocation;
  return (
    location === undefined ||
    (record(location) &&
      isLosslessNumber(location.latitude) &&
      isLosslessNumber(location.longitude) &&
      isLosslessNumber(location.accuracyKm) &&
      typeof location.source === 'string' &&
      (location.city === undefined || typeof location.city === 'string'))
  );
}

function rulesView(value: unknown): boolean {
  return (
    record(value) &&
    strings(value, 'policyHash') &&
    Array.isArray(value.rules) &&
    value.rules.every(
      (rule) =>
        record(rule) &&
        strings(rule, 'ruleId', 'algorithmVersion') &&
        typeof rule.enabled === 'boolean' &&
        record(rule.settings),
    )
  );
}

function editablePolicy(value: unknown): boolean {
  return (
    record(value) &&
    isLosslessNumber(value.revision) &&
    strings(value, 'policyHash') &&
    record(value.document)
  );
}

function safeIdentifier(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function retryTime(header: string | null): number | undefined {
  if (header === null) return undefined;
  const now = Date.now();
  const timestamp = /^\d+$/.test(header.trim())
    ? now + Number(header.trim()) * 1000
    : Date.parse(header);
  return Number.isFinite(timestamp) && timestamp > now ? timestamp : undefined;
}

function errorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'The request was not accepted. Check the filters and try again.';
    case 401:
      return 'The API key is no longer accepted. Connect again with a valid key.';
    case 403:
      return 'This API key does not have permission for this action.';
    case 404:
      return 'This resource is unavailable for the connected account.';
    case 429:
      return 'The request limit was reached. Wait before trying again.';
    case 503:
      return 'The service is temporarily unavailable. Try again when it recovers.';
    default:
      return 'The service could not complete the request. Try again later.';
  }
}

/** Each connection owns its key and cooldown in memory; nothing is stored in the browser. */
export function createApiClient(apiKey: string, options: ClientOptions = {}) {
  let cooldown: ApiError | undefined;

  async function get<T>(
    path: string,
    valid: (value: unknown) => boolean,
    signal?: AbortSignal,
  ): Promise<ApiResponse<Exact<T>>> {
    signal?.throwIfAborted();
    if (cooldown?.retryAt !== undefined && cooldown.retryAt > Date.now()) throw cooldown;

    let response: Response;
    let raw: string;
    try {
      response = await fetch(path, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-API-Key': apiKey },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal,
      });
      raw = await response.text();
      signal?.throwIfAborted();
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
        throw error;
      // Browser/network error messages can contain URLs. Keep the public error deliberately fixed.
      throw new ApiError(
        'Could not reach the service. Check that Docker is running and try again.',
        {
          status: 0,
          code: 'NETWORK_UNAVAILABLE',
        },
      );
    }

    let parsed: unknown;
    try {
      parsed = parse(raw);
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      const problem = record(parsed) ? parsed : {};
      const retryAt = retryTime(response.headers.get('Retry-After'));
      const failure = new ApiError(errorMessage(response.status), {
        status: response.status,
        code: safeIdentifier(problem.code, /^[A-Z][A-Z0-9_]{0,63}$/) ?? 'REQUEST_FAILED',
        correlationId:
          safeIdentifier(problem.correlationId, /^[A-Za-z0-9._:-]{1,128}$/) ??
          safeIdentifier(response.headers.get('X-Correlation-ID'), /^[A-Za-z0-9._:-]{1,128}$/),
        retryAt,
      });
      if (response.status === 401) options.onUnauthorized?.();
      if (retryAt !== undefined) {
        cooldown = failure;
        options.onRateLimit?.(retryAt);
      }
      throw failure;
    }

    if (!valid(parsed)) {
      throw new ApiError('The service returned an unreadable response. Try again later.', {
        status: response.status,
        code: 'INVALID_RESPONSE',
      });
    }
    return {
      data: parsed as Exact<T>,
      raw,
      ...(response.headers.has('ETag') ? { etag: response.headers.get('ETag')! } : {}),
    };
  }

  return {
    getEvaluations(filters: EvaluationFilters = {}, signal?: AbortSignal) {
      const query = new URLSearchParams();
      // The fixed list also prevents runtime callers from injecting arbitrary query keys.
      for (const key of [
        'customerId',
        'decision',
        'acceptedFrom',
        'acceptedTo',
        'pageSize',
        'cursor',
      ] as const) {
        const value = filters[key];
        if (value !== undefined && value !== '') query.set(key, String(value));
      }
      const search = query.toString();
      return get<components['schemas']['EvaluationPage']>(
        `/api/v1/evaluations${search ? `?${search}` : ''}`,
        evaluationPage,
        signal,
      );
    },
    getTransaction(eventId: string, signal?: AbortSignal) {
      return get<components['schemas']['TransactionResource']>(
        `/api/v1/transactions/${encodeURIComponent(eventId)}`,
        transactionResource,
        signal,
      );
    },
    getRules(signal?: AbortSignal) {
      return get<components['schemas']['RulesView']>('/api/v1/rules', rulesView, signal);
    },
    getEditablePolicy(signal?: AbortSignal) {
      return get<components['schemas']['EditablePolicy']>(
        '/api/v1/admin/policy',
        editablePolicy,
        signal,
      );
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function displayValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (isLosslessNumber(value)) return value.value;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return prettyJson(value);
}

export function prettyJson(value: unknown): string {
  try {
    const exact = typeof value === 'string' ? parse(value) : value;
    return stringify(exact, null, 2) ?? '';
  } catch {
    return typeof value === 'string' ? value : '';
  }
}
