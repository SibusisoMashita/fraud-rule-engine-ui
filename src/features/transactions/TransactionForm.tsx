import type { TransactionDraft } from './model';

export function TransactionForm({
  draft,
  onChange,
  disabled,
}: {
  draft: TransactionDraft;
  onChange: (draft: TransactionDraft) => void;
  disabled: boolean;
}) {
  function field<Key extends keyof TransactionDraft>(key: Key, value: TransactionDraft[Key]) {
    onChange({ ...draft, [key]: value });
  }
  function location(key: keyof TransactionDraft['physicalLocation'], value: string) {
    onChange({ ...draft, physicalLocation: { ...draft.physicalLocation, [key]: value } });
  }
  return (
    <fieldset className="transaction-fields" disabled={disabled}>
      <legend>Transaction fields</legend>
      <div className="transaction-grid">
        <label>
          Amount
          <input
            name="amount"
            inputMode="decimal"
            value={draft.amount}
            onChange={(event) => field('amount', event.target.value)}
            required
            maxLength={128}
          />
        </label>
        <label>
          Currency
          <input
            name="currency"
            value={draft.currency}
            onChange={(event) => field('currency', event.target.value)}
            required
            maxLength={3}
          />
        </label>
        <label>
          Event ID
          <input
            value={draft.eventId}
            onChange={(event) => field('eventId', event.target.value)}
            required
            maxLength={128}
          />
        </label>
        <label>
          Customer ID
          <input
            value={draft.customerId}
            onChange={(event) => field('customerId', event.target.value)}
            required
            maxLength={128}
          />
        </label>
        <label>
          Instrument ID
          <input
            value={draft.instrumentId}
            onChange={(event) => field('instrumentId', event.target.value)}
            required
            maxLength={128}
          />
        </label>
        <label>
          Transaction type
          <select
            value={draft.transactionType}
            onChange={(event) =>
              field('transactionType', event.target.value as TransactionDraft['transactionType'])
            }
          >
            <option value="CARD_PURCHASE">Card purchase</option>
            <option value="ATM_WITHDRAWAL">ATM withdrawal</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={draft.status}
            onChange={(event) => field('status', event.target.value as TransactionDraft['status'])}
          >
            <option value="BOOKED">Booked</option>
          </select>
        </label>
        <label>
          Channel
          <select
            value={draft.channel}
            onChange={(event) =>
              field('channel', event.target.value as TransactionDraft['channel'])
            }
          >
            <option value="ECOMMERCE">Ecommerce</option>
            <option value="CARD_PRESENT">Card present</option>
            <option value="ATM">ATM</option>
          </select>
        </label>
        <label>
          Category
          <input
            value={draft.category}
            onChange={(event) => field('category', event.target.value)}
            required
            maxLength={64}
          />
        </label>
        <label className="wide-field">
          Occurred at
          <input
            value={draft.occurredAt}
            onChange={(event) => field('occurredAt', event.target.value)}
            placeholder="ISO timestamp including Z or an offset"
            required
            maxLength={40}
          />
        </label>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={draft.locationEnabled}
          onChange={(event) => field('locationEnabled', event.target.checked)}
        />
        Include physical location
      </label>
      {draft.locationEnabled && (
        <div className="transaction-grid location-fields">
          <label>
            Latitude
            <input
              inputMode="decimal"
              value={draft.physicalLocation.latitude}
              onChange={(event) => location('latitude', event.target.value)}
              required
              maxLength={128}
            />
          </label>
          <label>
            Longitude
            <input
              inputMode="decimal"
              value={draft.physicalLocation.longitude}
              onChange={(event) => location('longitude', event.target.value)}
              required
              maxLength={128}
            />
          </label>
          <label>
            Accuracy (km)
            <input
              inputMode="decimal"
              value={draft.physicalLocation.accuracyKm}
              onChange={(event) => location('accuracyKm', event.target.value)}
              required
              maxLength={128}
            />
          </label>
          <label>
            Location source
            <select
              value={draft.physicalLocation.source}
              onChange={(event) => location('source', event.target.value)}
            >
              <option value="VERIFIED_CARD_PRESENT_TERMINAL">Verified card terminal</option>
              <option value="VERIFIED_ATM_TERMINAL">Verified ATM terminal</option>
            </select>
          </label>
          <label>
            City
            <input
              value={draft.physicalLocation.city}
              onChange={(event) => location('city', event.target.value)}
              maxLength={128}
            />
          </label>
        </div>
      )}
      <p className="muted">
        Amounts and coordinates keep the exact text you enter. The API validates the event,
        permissions and active policy.
      </p>
    </fieldset>
  );
}
