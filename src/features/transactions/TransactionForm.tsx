import { AmountInput } from './AmountInput';
import { demoLocations, type TransactionDraft } from './model';

export function TransactionForm({
  draft,
  onChange,
  disabled,
  currencies,
  loadingCurrencies,
}: {
  draft: TransactionDraft;
  onChange: (draft: TransactionDraft) => void;
  disabled: boolean;
  currencies: string[];
  loadingCurrencies: boolean;
}) {
  function field<Key extends keyof TransactionDraft>(key: Key, value: TransactionDraft[Key]) {
    onChange({ ...draft, [key]: value });
  }
  function channel(value: TransactionDraft['channel'], type = draft.transactionType) {
    onChange({
      ...draft,
      transactionType: type,
      channel: value,
      locationEnabled: value !== 'ECOMMERCE' && draft.locationEnabled,
      physicalLocation: {
        ...draft.physicalLocation,
        source: value === 'ATM' ? 'VERIFIED_ATM_TERMINAL' : 'VERIFIED_CARD_PRESENT_TERMINAL',
      },
    });
  }
  const selectedLocation = demoLocations.find(
    (place) =>
      place.latitude === draft.physicalLocation.latitude &&
      place.longitude === draft.physicalLocation.longitude,
  );
  return (
    <fieldset className="transaction-fields" disabled={disabled}>
      <legend>Transaction fields</legend>
      <div className="transaction-grid">
        <AmountInput
          label="Amount"
          value={draft.amount}
          onChange={(value) => field('amount', value)}
        />
        <label>
          Currency
          <select
            value={currencies.includes(draft.currency) ? draft.currency : ''}
            onChange={(event) => field('currency', event.target.value)}
            required
            disabled={loadingCurrencies || currencies.length === 0}
          >
            <option value="" disabled>
              {loadingCurrencies ? 'Loading currencies…' : 'Choose an active currency'}
            </option>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Event ID
          <input value={draft.eventId} readOnly />
        </label>
        <label>
          Customer ID
          <input value={draft.customerId} readOnly />
        </label>
        <label>
          Instrument ID
          <input value={draft.instrumentId} readOnly />
        </label>
        <label>
          Transaction type
          <select
            value={draft.transactionType}
            onChange={(event) => {
              const type = event.target.value as TransactionDraft['transactionType'];
              channel(type === 'ATM_WITHDRAWAL' ? 'ATM' : 'ECOMMERCE', type);
            }}
          >
            <option value="CARD_PURCHASE">Card purchase</option>
            <option value="ATM_WITHDRAWAL">ATM withdrawal</option>
          </select>
        </label>
        <label>
          Status
          <input value="Booked" readOnly />
        </label>
        <label>
          Channel
          <select
            value={draft.channel}
            onChange={(event) => channel(event.target.value as TransactionDraft['channel'])}
          >
            {draft.transactionType === 'ATM_WITHDRAWAL' ? (
              <option value="ATM">ATM</option>
            ) : (
              <>
                <option value="ECOMMERCE">Ecommerce</option>
                <option value="CARD_PRESENT">Card present</option>
              </>
            )}
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
          <input value={draft.occurredAt} readOnly aria-describedby="event-time-help" />
        </label>
      </div>
      <p id="event-time-help" className="muted">
        IDs are generated for each new run. Times are set when sending; scenarios keep their
        original time gaps.
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={draft.locationEnabled}
          disabled={draft.channel === 'ECOMMERCE'}
          onChange={(event) => field('locationEnabled', event.target.checked)}
        />
        Include physical location
      </label>
      {draft.channel === 'ECOMMERCE' && (
        <p className="muted">
          Physical location is available for card-present purchases and ATM withdrawals.
        </p>
      )}
      {draft.locationEnabled && (
        <>
          <label>
            Demo location
            <select
              value={selectedLocation?.id ?? ''}
              onChange={(event) => {
                const place = demoLocations.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (place)
                  onChange({
                    ...draft,
                    physicalLocation: {
                      latitude: place.latitude,
                      longitude: place.longitude,
                      accuracyKm: place.accuracyKm,
                      city: place.city,
                      source: draft.physicalLocation.source,
                    },
                  });
              }}
            >
              <option value="" disabled>
                Choose a location
              </option>
              {demoLocations.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.city}
                </option>
              ))}
            </select>
          </label>
          {selectedLocation && (
            <p>
              <a
                className="button secondary"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedLocation.latitude},${selectedLocation.longitude}`)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Google Maps<span className="sr-only"> (opens a new tab)</span>
              </a>
            </p>
          )}
          <div className="transaction-grid location-fields">
            <label>
              Latitude
              <input value={draft.physicalLocation.latitude} readOnly />
            </label>
            <label>
              Longitude
              <input value={draft.physicalLocation.longitude} readOnly />
            </label>
            <label>
              Accuracy (km)
              <input value={draft.physicalLocation.accuracyKm} readOnly />
            </label>
            <label>
              Location source
              <input value={draft.physicalLocation.source} readOnly />
            </label>
            <label>
              City
              <input value={draft.physicalLocation.city} readOnly />
            </label>
          </div>
          <p className="muted">
            These sample coordinates represent synthetic terminal evidence. Google Maps opens a
            reference view in a new tab; it does not change the transaction location.
          </p>
        </>
      )}
      <p className="muted">
        Amounts stay exact decimal strings. The API validates the event, permissions and active
        policy.
      </p>
    </fieldset>
  );
}
