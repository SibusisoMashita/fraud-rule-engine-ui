import { compareNumber, LosslessNumber, parse, stringify } from 'lossless-json';
import type { components } from '../../api/generated';

type TransactionInput = components['schemas']['TransactionInput'];
type PhysicalLocation = components['schemas']['PhysicalLocation'];

export interface TransactionDraft {
  eventId: string;
  customerId: string;
  instrumentId: string;
  transactionType: TransactionInput['transactionType'];
  status: TransactionInput['status'];
  channel: TransactionInput['channel'];
  amount: string;
  currency: string;
  category: string;
  occurredAt: string;
  locationEnabled: boolean;
  physicalLocation: {
    latitude: string;
    longitude: string;
    accuracyKm: string;
    source: PhysicalLocation['source'];
    city: string;
  };
}

export const scenarioPresets = [
  {
    id: 'HIGH_AMOUNT',
    name: 'High amount',
    description: 'One example payment of ZAR 25000.01.',
  },
  {
    id: 'TRANSACTION_VELOCITY',
    name: 'Transaction velocity',
    description: 'Six example payments of ZAR 10 within a few minutes.',
  },
  {
    id: 'CUMULATIVE_SPEND',
    name: 'Cumulative spend',
    description: 'Two example payments of ZAR 16000, five minutes apart.',
  },
  {
    id: 'IMPOSSIBLE_TRAVEL',
    name: 'Impossible travel',
    description: 'Verified purchases in Cape Town and Johannesburg, two minutes apart.',
  },
  {
    id: 'SMALL_PAYMENT_BURST_THEN_LARGE',
    name: 'Small payment burst',
    description: 'Three example payments of ZAR 10 followed by ZAR 6000.',
  },
] as const;

export type ScenarioId = (typeof scenarioPresets)[number]['id'];
export interface ScenarioDraft {
  id: ScenarioId;
  name: string;
  description: string;
  transactions: TransactionDraft[];
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MONEY = /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,4})?$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const TIMESTAMP =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-8]):[0-5]\d)$/;

export function createManualDraft(): TransactionDraft {
  return {
    eventId: `demo-event-${crypto.randomUUID()}`,
    customerId: `demo-customer-${crypto.randomUUID()}`,
    instrumentId: `demo-card-${crypto.randomUUID()}`,
    transactionType: 'CARD_PURCHASE',
    status: 'BOOKED',
    channel: 'ECOMMERCE',
    amount: '100.00',
    currency: 'ZAR',
    category: 'GROCERIES',
    occurredAt: new Date().toISOString(),
    locationEnabled: false,
    physicalLocation: {
      latitude: '-33.9249',
      longitude: '18.4241',
      accuracyKm: '1',
      source: 'VERIFIED_CARD_PRESENT_TERMINAL',
      city: 'Cape Town',
    },
  };
}

/** Illustrative inputs only. The backend's active policy determines every outcome. */
export function createScenarioDraft(id: ScenarioId): ScenarioDraft {
  const preset = scenarioPresets.find((candidate) => candidate.id === id);
  if (!preset) throw new Error('Choose an available scenario.');
  const base = createManualDraft();
  const now = Date.now();
  const event = (amount: string, secondsAgo: number): TransactionDraft => ({
    ...base,
    eventId: `demo-event-${crypto.randomUUID()}`,
    amount,
    occurredAt: new Date(now - secondsAgo * 1000).toISOString(),
    physicalLocation: { ...base.physicalLocation },
  });
  let transactions: TransactionDraft[];
  switch (id) {
    case 'HIGH_AMOUNT':
      transactions = [event('25000.01', 0)];
      break;
    case 'TRANSACTION_VELOCITY':
      transactions = [150, 120, 90, 60, 30, 0].map((secondsAgo) => event('10.00', secondsAgo));
      break;
    case 'CUMULATIVE_SPEND':
      transactions = [event('16000.00', 300), event('16000.00', 0)];
      break;
    case 'IMPOSSIBLE_TRAVEL': {
      const capeTown = event('10.00', 120);
      capeTown.channel = 'CARD_PRESENT';
      capeTown.locationEnabled = true;
      const johannesburg = event('10.00', 0);
      johannesburg.channel = 'CARD_PRESENT';
      johannesburg.locationEnabled = true;
      johannesburg.physicalLocation = {
        ...johannesburg.physicalLocation,
        latitude: '-26.2041',
        longitude: '28.0473',
        city: 'Johannesburg',
      };
      transactions = [capeTown, johannesburg];
      break;
    }
    case 'SMALL_PAYMENT_BURST_THEN_LARGE':
      transactions = [
        ...[180, 120, 60].map((secondsAgo) => event('10.00', secondsAgo)),
        event('6000.00', 0),
      ];
      break;
  }
  return { ...preset, transactions };
}

function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function timestamp(value: string) {
  requireValue(
    TIMESTAMP.test(value),
    'Use an ISO timestamp with a timezone and up to six fractional digits.',
  );
  const instant = new Date(value);
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  requireValue(
    Number.isFinite(instant.getTime()) &&
      instant.getUTCFullYear() >= 1 &&
      instant.getUTCFullYear() <= 9999 &&
      calendar.toISOString().slice(0, 10) === value.slice(0, 10) &&
      !/[+-]18:(?!00$)/.test(value),
    'Enter a valid calendar time and timezone.',
  );
}

function decimal(value: string, name: string, minimum: string, maximum?: string) {
  requireValue(DECIMAL.test(value), `${name} must be a plain decimal number.`);
  requireValue(
    compareNumber(value, minimum) >= 0 &&
      (maximum === undefined || compareNumber(value, maximum) <= 0),
    `${name} is outside its allowed range.`,
  );
  return new LosslessNumber(value);
}

function validateAmount(amount: string) {
  requireValue(
    MONEY.test(amount) && compareNumber(amount, '0') > 0,
    'Amount must be a positive decimal string, with up to 16 whole digits and four fractional digits.',
  );
}

/** Change only the amount under the retained event identity, without rounding its evidence. */
export function conflictingPayload(raw: string, amount: string): string {
  validateAmount(amount);
  let payload: unknown;
  try {
    payload = parse(raw);
  } catch {
    throw new Error('The retained transaction payload is unreadable.');
  }
  requireValue(
    typeof payload === 'object' && payload !== null && !Array.isArray(payload),
    'The retained transaction payload is unreadable.',
  );
  const transaction = payload as Record<string, unknown>;
  requireValue(
    typeof transaction.amount === 'string',
    'The retained transaction payload must contain a monetary string.',
  );
  validateAmount(transaction.amount);
  requireValue(
    compareNumber(transaction.amount, amount) !== 0,
    'Use a numerically different amount for the conflicting duplicate.',
  );
  transaction.amount = amount;
  return stringify(transaction)!;
}

/** Preserve submitted text; policy eligibility and business thresholds remain server-owned. */
export function serializeDraft(draft: TransactionDraft): string {
  for (const [name, value] of [
    ['Event ID', draft.eventId],
    ['Customer ID', draft.customerId],
    ['Instrument ID', draft.instrumentId],
  ]) {
    requireValue(
      IDENTIFIER.test(value),
      `${name} must use 1–128 letters, numbers, dots, underscores, colons or hyphens, starting with a letter or number.`,
    );
  }
  requireValue(
    ['CARD_PURCHASE', 'ATM_WITHDRAWAL'].includes(draft.transactionType) &&
      ['CARD_PRESENT', 'ECOMMERCE', 'ATM'].includes(draft.channel) &&
      (draft.transactionType === 'ATM_WITHDRAWAL') === (draft.channel === 'ATM'),
    'Choose a matching transaction type and channel.',
  );
  requireValue(draft.status === 'BOOKED', 'Only BOOKED transactions are supported.');
  validateAmount(draft.amount);
  requireValue(/^[A-Z]{3}$/.test(draft.currency), 'Currency must be three uppercase letters.');
  requireValue(
    draft.category.trim().length > 0 && Array.from(draft.category).length <= 64,
    'Enter a category of up to 64 characters.',
  );
  timestamp(draft.occurredAt);

  const input = {
    eventId: draft.eventId,
    customerId: draft.customerId,
    instrumentId: draft.instrumentId,
    transactionType: draft.transactionType,
    status: draft.status,
    channel: draft.channel,
    amount: draft.amount,
    currency: draft.currency,
    category: draft.category,
    occurredAt: draft.occurredAt,
  };
  if (!draft.locationEnabled) return stringify(input)!;

  const location = draft.physicalLocation;
  requireValue(draft.channel !== 'ECOMMERCE', 'Online payments cannot assert a physical location.');
  requireValue(
    ['VERIFIED_ATM_TERMINAL', 'VERIFIED_CARD_PRESENT_TERMINAL'].includes(location.source) &&
      (draft.channel === 'ATM') === (location.source === 'VERIFIED_ATM_TERMINAL'),
    'Choose a location source matching the physical transaction channel.',
  );
  requireValue(Array.from(location.city).length <= 128, 'City must be at most 128 characters.');
  return stringify({
    ...input,
    physicalLocation: {
      latitude: decimal(location.latitude, 'Latitude', '-90', '90'),
      longitude: decimal(location.longitude, 'Longitude', '-180', '180'),
      accuracyKm: decimal(location.accuracyKm, 'Accuracy radius', '0'),
      source: location.source,
      ...(location.city ? { city: location.city } : {}),
    },
  })!;
}
