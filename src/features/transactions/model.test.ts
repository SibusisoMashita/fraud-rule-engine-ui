import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLosslessNumber, parse } from 'lossless-json';
import {
  conflictingPayload,
  createManualDraft,
  createScenarioDraft,
  scenarioPresets,
  serializeDraft,
  type TransactionDraft,
} from './model';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('editable synthetic inputs', () => {
  it('creates fresh manual identities and omits an unused location', () => {
    const first = createManualDraft();
    const second = createManualDraft();
    expect(first.eventId).not.toBe(second.eventId);
    expect(first.customerId).not.toBe(second.customerId);
    expect(first.instrumentId).not.toBe(second.instrumentId);
    first.physicalLocation.latitude = 'unused invalid text';
    expect(JSON.parse(serializeDraft(first))).toMatchObject({
      transactionType: 'CARD_PURCHASE',
      status: 'BOOKED',
      channel: 'ECOMMERCE',
      amount: '100.00',
      currency: 'ZAR',
      category: 'GROCERIES',
      occurredAt: '2026-10-18T12:00:00.000Z',
    });
    expect(serializeDraft(first)).not.toContain('physicalLocation');
  });

  it.each(scenarioPresets)(
    '$name shares one instrument and uses ordered, distinct events',
    ({ id }) => {
      const scenario = createScenarioDraft(id);
      expect(new Set(scenario.transactions.map((draft) => draft.customerId)).size).toBe(1);
      expect(new Set(scenario.transactions.map((draft) => draft.instrumentId)).size).toBe(1);
      expect(new Set(scenario.transactions.map((draft) => draft.eventId)).size).toBe(
        scenario.transactions.length,
      );
      const times = scenario.transactions.map((draft) => Date.parse(draft.occurredAt));
      expect(times).toEqual([...times].sort((left, right) => left - right));
      expect(times.at(-1)).toBe(Date.now());
      expect(times[0]).toBeGreaterThanOrEqual(Date.now() - 1800 * 1000);
      for (const draft of scenario.transactions) expect(() => serializeDraft(draft)).not.toThrow();
    },
  );

  it('keeps edits isolated between steps and repeated scenario runs', () => {
    const first = createScenarioDraft('IMPOSSIBLE_TRAVEL');
    const second = createScenarioDraft('IMPOSSIBLE_TRAVEL');
    first.transactions[0].amount = '42.00';
    first.transactions[0].physicalLocation.city = 'Edited city';
    expect(first.transactions[1].physicalLocation.city).toBe('Johannesburg');
    expect(second.transactions[0].amount).toBe('10.00');
    expect(second.transactions[0].physicalLocation.city).toBe('Cape Town');
    expect(second.transactions[0].customerId).not.toBe(first.transactions[0].customerId);
    expect(second.transactions[0].instrumentId).not.toBe(first.transactions[0].instrumentId);
    expect(second.transactions.map((draft) => draft.eventId)).not.toContain(
      first.transactions[0].eventId,
    );
  });

  it('provides the five illustrative sequences without predicting a decision', () => {
    const amounts = scenarioPresets.map(({ id }) =>
      createScenarioDraft(id).transactions.map((draft) => draft.amount),
    );
    expect(amounts).toEqual([
      ['25000.01'],
      ['10.00', '10.00', '10.00', '10.00', '10.00', '10.00'],
      ['16000.00', '16000.00'],
      ['10.00', '10.00'],
      ['10.00', '10.00', '10.00', '6000.00'],
    ]);
    expect(createScenarioDraft('HIGH_AMOUNT')).not.toHaveProperty('decision');
  });

  it('uses actual Cape Town and Johannesburg coordinates two minutes apart', () => {
    const [capeTown, johannesburg] = createScenarioDraft('IMPOSSIBLE_TRAVEL').transactions;
    expect(capeTown.physicalLocation).toMatchObject({
      latitude: '-33.9249',
      longitude: '18.4241',
      accuracyKm: '1',
      source: 'VERIFIED_CARD_PRESENT_TERMINAL',
      city: 'Cape Town',
    });
    expect(johannesburg.physicalLocation).toMatchObject({
      latitude: '-26.2041',
      longitude: '28.0473',
      city: 'Johannesburg',
    });
    expect(Date.parse(johannesburg.occurredAt) - Date.parse(capeTown.occurredAt)).toBe(120_000);
    expect(serializeDraft(capeTown)).toContain('"latitude":-33.9249');
  });
});

describe('exact request serialization', () => {
  it('retains monetary, timestamp and coordinate text without mutating the draft', () => {
    const draft = createScenarioDraft('IMPOSSIBLE_TRAVEL').transactions[0];
    draft.amount = '9999999999999999.9999';
    draft.occurredAt = '2026-10-18T12:00:00.123456+02:00';
    draft.physicalLocation.latitude = '-33.92490000000000000000000001';
    draft.physicalLocation.accuracyKm = '0.12345678901234567890123456789';
    const original = structuredClone(draft);
    const raw = serializeDraft(draft);
    expect(raw).toContain('"amount":"9999999999999999.9999"');
    expect(raw).toContain('"occurredAt":"2026-10-18T12:00:00.123456+02:00"');
    expect(raw).toContain('"latitude":-33.92490000000000000000000001');
    expect(raw).toContain('"accuracyKm":0.12345678901234567890123456789');
    const parsed = parse(raw) as { physicalLocation: { accuracyKm: unknown } };
    expect(isLosslessNumber(parsed.physicalLocation.accuracyKm)).toBe(true);
    expect(draft).toEqual(original);
    expect(serializeDraft(draft)).toBe(raw);
  });

  it('preserves numeric zero representations and omits an empty optional city', () => {
    const draft = createScenarioDraft('IMPOSSIBLE_TRAVEL').transactions[0];
    draft.physicalLocation = {
      ...draft.physicalLocation,
      latitude: '90.0000',
      longitude: '-180.00000',
      accuracyKm: '-0.0000',
      city: '',
    };
    expect(serializeDraft(draft)).toContain('"accuracyKm":-0.0000');
    expect(serializeDraft(draft)).not.toContain('"city"');
  });

  it.each([
    ['latitude', '90.000000000000000000000000001'],
    ['latitude', '-90.000000000000000000000000001'],
    ['longitude', '180.000000000000000000000000001'],
    ['accuracyKm', '-0.000000000000000000000000001'],
    ['accuracyKm', 'NaN'],
  ] as const)('rejects invalid %s without rounding %s', (field, value) => {
    const draft = createScenarioDraft('IMPOSSIBLE_TRAVEL').transactions[0];
    draft.physicalLocation[field] = value;
    expect(() => serializeDraft(draft)).toThrow();
  });

  it.each([
    '2026-02-30T12:00:00Z',
    '2026-10-18T12:00:00',
    '2026-10-18T12:00:00.1234567Z',
    '0000-01-01T00:00:00Z',
    '2026-10-18T12:00:60Z',
    '2026-10-18T12:00:00+18:01',
  ])('rejects an invalid timestamp rather than changing it: %s', (occurredAt) => {
    const draft = createManualDraft();
    draft.occurredAt = occurredAt;
    expect(() => serializeDraft(draft)).toThrow();
  });

  it.each([
    { eventId: 'bad event' },
    { customerId: '' },
    { amount: '0.00' },
    { amount: '1e3' },
    { amount: ' 1.00 ' },
    { currency: 'zar' },
    { category: ' ' },
  ])('rejects invalid static fields: %j', (changes) => {
    const draft = { ...createManualDraft(), ...changes };
    expect(() => serializeDraft(draft)).toThrow();
  });

  it('checks physical source and transaction-channel agreement', () => {
    const draft = createManualDraft();
    draft.locationEnabled = true;
    expect(() => serializeDraft(draft)).toThrow('Online payments');
    draft.transactionType = 'ATM_WITHDRAWAL';
    draft.channel = 'ATM';
    expect(() => serializeDraft(draft)).toThrow('location source');
    draft.physicalLocation.source = 'VERIFIED_ATM_TERMINAL';
    expect(() => serializeDraft(draft)).not.toThrow();
    draft.channel = 'CARD_PRESENT';
    expect(() => serializeDraft(draft)).toThrow('matching transaction type');
  });

  it('leaves currency support, age and rule thresholds to the live backend policy', () => {
    const draft: TransactionDraft = {
      ...createManualDraft(),
      currency: 'USD',
      amount: '100.1234',
      occurredAt: '2020-01-01T00:00:00Z',
    };
    expect(() => serializeDraft(draft)).not.toThrow();
  });
});

describe('conflicting duplicate payloads', () => {
  it('changes only the amount while retaining exact coordinates, identity and timestamp', () => {
    const draft = createScenarioDraft('IMPOSSIBLE_TRAVEL').transactions[0];
    draft.amount = '9999999999999999.9998';
    draft.occurredAt = '2026-10-18T12:00:00.123456+02:00';
    draft.physicalLocation.accuracyKm = '0.12345678901234567890123456789';
    const raw = serializeDraft(draft);
    const changed = conflictingPayload(raw, '9999999999999999.9999');
    expect(changed).toBe(raw.replace('9999999999999999.9998', '9999999999999999.9999'));
    expect(changed).toContain('"accuracyKm":0.12345678901234567890123456789');
    expect(changed).toContain('"occurredAt":"2026-10-18T12:00:00.123456+02:00"');
    expect(draft.amount).toBe('9999999999999999.9998');
  });

  it.each(['100', '100.0', '100.00', '100.0000'])(
    'rejects numeric equivalence instead of promising a conflict for %s',
    (amount) => {
      expect(() => conflictingPayload(serializeDraft(createManualDraft()), amount)).toThrow(
        'numerically different',
      );
    },
  );

  it.each(['0', '-1', '01.00', '1.00000', '1e3', ' 101.00 ', '10000000000000000', ''])(
    'uses the same positive monetary format for conflicting amounts: %j',
    (amount) => {
      expect(() => conflictingPayload(serializeDraft(createManualDraft()), amount)).toThrow(
        'positive decimal string',
      );
    },
  );

  it.each(['not JSON', 'null', '[]', '{}', '{"amount":100}', '{"amount":"invalid"}'])(
    'rejects an unusable retained payload: %s',
    (raw) => {
      expect(() => conflictingPayload(raw, '101.00')).toThrow();
    },
  );
});
