import { isLosslessNumber, LosslessNumber, parse, stringify } from 'lossless-json';

export type PolicyObject = Record<string, unknown>;
export type PolicyPath = readonly string[];
export interface PolicyChange {
  path: string;
  before: string;
  after: string;
}

export const amountMaps = [
  ['rules', 'highAmount', 'thresholds'],
  ['rules', 'cumulativeSpend', 'thresholds'],
  ['rules', 'smallPaymentBurstThenLarge', 'smallPaymentMaximum'],
  ['rules', 'smallPaymentBurstThenLarge', 'largePaymentThreshold'],
] as const;

function object(value: unknown): value is PolicyObject {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !isLosslessNumber(value)
  );
}

export function at(document: PolicyObject, path: PolicyPath): unknown {
  let value: unknown = document;
  for (const key of path) value = object(value) ? value[key] : undefined;
  return value;
}

function requireType(
  document: PolicyObject,
  path: PolicyPath,
  test: (value: unknown) => boolean,
  expected: string,
) {
  if (!test(at(document, path))) throw new Error(`${path.join('.')} must be ${expected}.`);
}

/** Checks the form's shape only. The engine validates policy bounds and rule compatibility. */
export function parseDraft(raw: string, strict = false): PolicyObject {
  let document: unknown;
  try {
    document = parse(raw);
  } catch {
    throw new Error('Policy JSON must be valid JSON. Repair the JSON to use the forms.');
  }
  if (!object(document)) throw new Error('Policy JSON must be an object.');
  const number = (value: unknown) =>
    isLosslessNumber(value) || (!strict && typeof value === 'string');
  const string = (value: unknown) => typeof value === 'string';
  const boolean = (value: unknown) => typeof value === 'boolean';
  const strings = (value: unknown) => Array.isArray(value) && value.every(string);
  for (const path of [
    ['supportedCurrencies'],
    ['ingest'],
    ['rules'],
    ['rules', 'highAmount'],
    ['rules', 'transactionVelocity'],
    ['rules', 'cumulativeSpend'],
    ['rules', 'impossibleTravel'],
    ['rules', 'smallPaymentBurstThenLarge'],
    ...amountMaps,
  ])
    requireType(document, path, object, 'an object');
  for (const key of ['schemaVersion', 'canonicalizationVersion'])
    requireType(document, [key], number, 'a JSON number');
  const currencies = at(document, ['supportedCurrencies']) as PolicyObject;
  for (const code of Object.keys(currencies)) {
    if (!/^[A-Z]{3}$/.test(code))
      throw new Error('Currency codes must contain three uppercase letters.');
    requireType(document, ['supportedCurrencies', code], object, 'an object');
    requireType(document, ['supportedCurrencies', code, 'scale'], number, 'a JSON number');
    requireType(document, ['supportedCurrencies', code, 'maxAmount'], string, 'a monetary string');
    for (const path of amountMaps)
      requireType(document, [...path, code], string, 'a monetary string');
  }
  for (const rule of [
    'highAmount',
    'transactionVelocity',
    'cumulativeSpend',
    'impossibleTravel',
    'smallPaymentBurstThenLarge',
  ]) {
    requireType(document, ['rules', rule, 'enabled'], boolean, 'true or false');
  }
  for (const path of [
    ['ingest', 'maxEventAgeSeconds'],
    ['ingest', 'maxFutureSkewSeconds'],
    ['rules', 'transactionVelocity', 'windowSeconds'],
    ['rules', 'transactionVelocity', 'maxTransactions'],
    ['rules', 'cumulativeSpend', 'windowSeconds'],
    ...[
      'maxComparisonAgeSeconds',
      'maxCandidates',
      'maxSpeedKmh',
      'minDistanceKm',
      'travelAllowanceKm',
      'maxAccuracyKm',
    ].map((key) => ['rules', 'impossibleTravel', key]),
    ['rules', 'smallPaymentBurstThenLarge', 'windowSeconds'],
    ['rules', 'smallPaymentBurstThenLarge', 'minSmallPayments'],
  ])
    requireType(document, path, number, 'a JSON number');
  for (const key of ['trustedSources', 'eligibleChannels'])
    requireType(document, ['rules', 'impossibleTravel', key], strings, 'an array of strings');
  return document;
}

export function policyJson(document: unknown): string {
  return stringify(document, undefined, 2) ?? '';
}

export function fieldText(value: unknown): string {
  return isLosslessNumber(value) ? value.value : typeof value === 'string' ? value : '';
}

/** Empty/unfinished numeric input remains visible in the shared JSON until corrected. */
export function numericInput(text: string): LosslessNumber | string {
  try {
    return new LosslessNumber(text);
  } catch {
    return text;
  }
}

export function changeField(raw: string, path: PolicyPath, value: unknown): string {
  const document = parseDraft(raw);
  const parent = at(document, path.slice(0, -1));
  if (!object(parent)) throw new Error(`Cannot edit ${path.join('.')}.`);
  parent[path[path.length - 1]] = value;
  return policyJson(document);
}

export function changeCurrency(raw: string, code: string, remove = false): string {
  if (!/^[A-Z]{3}$/.test(code)) throw new Error('Enter a three-letter uppercase currency code.');
  const document = parseDraft(raw);
  const currencies = at(document, ['supportedCurrencies']) as PolicyObject;
  if (!remove && Object.hasOwn(currencies, code)) throw new Error(`${code} is already present.`);
  if (remove) delete currencies[code];
  else currencies[code] = { scale: '', maxAmount: '' };
  for (const path of amountMaps) {
    const map = at(document, path) as PolicyObject;
    if (remove) delete map[code];
    else map[code] = '';
  }
  return policyJson(document);
}

function leaves(value: unknown, prefix = '', output = new Map<string, string>()) {
  if (object(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) output.set(prefix, '{}');
    for (const [key, child] of entries) leaves(child, prefix ? `${prefix}.${key}` : key, output);
  } else output.set(prefix, policyJson(value));
  return output;
}

export function policyChanges(before: unknown, raw: string): PolicyChange[] {
  const left = leaves(before);
  const right = leaves(parseDraft(raw, true));
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap((path) => {
    const oldValue = left.get(path) ?? '(absent)';
    const newValue = right.get(path) ?? '(absent)';
    return oldValue === newValue ? [] : [{ path, before: oldValue, after: newValue }];
  });
}
