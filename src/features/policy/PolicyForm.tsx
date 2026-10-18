import { useId, useState, type ReactNode } from 'react';
import {
  at,
  changeCurrency,
  changeField,
  fieldText,
  numericInput,
  parseDraft,
  type PolicyObject,
  type PolicyPath,
} from './model';

interface Props {
  raw: string;
  disabled: boolean;
  onChange: (raw: string) => void;
}

export function PolicyForm({ raw, disabled, onChange }: Props) {
  const prefix = useId();
  const [currency, setCurrency] = useState('');
  const [currencyError, setCurrencyError] = useState('');
  let document: PolicyObject;
  try {
    document = parseDraft(raw);
  } catch (error) {
    return (
      <p role="alert">
        {(error as Error).message} The advanced JSON editor remains available below.
      </p>
    );
  }

  function field(label: string, path: PolicyPath, numeric = true) {
    const id = `${prefix}-${path.join('-')}`;
    return (
      <label key={id} htmlFor={id}>
        {label}
        <input
          id={id}
          type="text"
          inputMode={numeric ? 'decimal' : undefined}
          value={fieldText(at(document, path))}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              changeField(
                raw,
                path,
                numeric ? numericInput(event.target.value) : event.target.value,
              ),
            )
          }
        />
      </label>
    );
  }
  function check(label: string, path: PolicyPath) {
    return (
      <label key={path.join('.')}>
        <input
          type="checkbox"
          checked={at(document, path) === true}
          disabled={disabled}
          onChange={(event) => onChange(changeField(raw, path, event.target.checked))}
        />
        {label}
      </label>
    );
  }
  function option(label: string, key: string, value: string) {
    const path = ['rules', 'impossibleTravel', key];
    const values = at(document, path) as string[];
    return (
      <label key={value}>
        <input
          type="checkbox"
          checked={values.includes(value)}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              changeField(
                raw,
                path,
                event.target.checked ? [...values, value] : values.filter((item) => item !== value),
              ),
            )
          }
        />
        {label}
      </label>
    );
  }
  const currencies = Object.keys(at(document, ['supportedCurrencies']) as PolicyObject).sort();
  const rule = (name: string, key: string, enabled: string, children: ReactNode) => (
    <fieldset className="policy-section">
      <legend>{name}</legend>
      <div className="policy-checks">{check(enabled, ['rules', key, 'enabled'])}</div>
      <div className="policy-field-grid">{children}</div>
    </fieldset>
  );

  return (
    <div className="policy-form-grid">
      <fieldset className="policy-section">
        <legend>Currencies</legend>
        {currencies.map((code) => (
          <div key={code}>
            <div className="currency-heading">
              <h4>{code}</h4>
              <button
                className="button secondary compact"
                disabled={disabled}
                onClick={() => onChange(changeCurrency(raw, code, true))}
              >
                Remove currency {code}
              </button>
            </div>
            <div className="policy-field-grid">
              {field(`Currency ${code} scale`, ['supportedCurrencies', code, 'scale'])}
              {field(
                `Currency ${code} maximum amount`,
                ['supportedCurrencies', code, 'maxAmount'],
                false,
              )}
            </div>
          </div>
        ))}
        <div className="currency-add">
          <label>
            New currency code
            <input
              type="text"
              maxLength={3}
              value={currency}
              disabled={disabled}
              onChange={(event) => {
                setCurrency(event.target.value.toUpperCase());
                setCurrencyError('');
              }}
            />
          </label>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => {
              try {
                onChange(changeCurrency(raw, currency));
                setCurrency('');
                setCurrencyError('');
              } catch (error) {
                setCurrencyError((error as Error).message);
              }
            }}
          >
            Add currency
          </button>
        </div>
        {currencyError && <p role="alert">{currencyError}</p>}
        <p className="muted">
          New currencies start blank. Enter their scale, maximum amount and each rule’s amounts
          before validation.
        </p>
      </fieldset>
      <fieldset className="policy-section">
        <legend>Accepted event timing</legend>
        <div className="policy-field-grid">
          {field('Maximum event age (seconds)', ['ingest', 'maxEventAgeSeconds'])}
          {field('Maximum future skew (seconds)', ['ingest', 'maxFutureSkewSeconds'])}
        </div>
      </fieldset>
      {rule(
        'High amount',
        'highAmount',
        'High amount enabled',
        currencies.map((code) =>
          field(
            `High amount threshold (${code})`,
            ['rules', 'highAmount', 'thresholds', code],
            false,
          ),
        ),
      )}
      {rule(
        'Transaction velocity',
        'transactionVelocity',
        'Transaction velocity enabled',
        <>
          {field('Velocity window (seconds)', ['rules', 'transactionVelocity', 'windowSeconds'])}
          {field('Velocity maximum transactions', [
            'rules',
            'transactionVelocity',
            'maxTransactions',
          ])}
        </>,
      )}
      {rule(
        'Cumulative spend',
        'cumulativeSpend',
        'Cumulative spend enabled',
        <>
          {field('Cumulative window (seconds)', ['rules', 'cumulativeSpend', 'windowSeconds'])}
          {currencies.map((code) =>
            field(
              `Cumulative threshold (${code})`,
              ['rules', 'cumulativeSpend', 'thresholds', code],
              false,
            ),
          )}
        </>,
      )}
      <fieldset className="policy-section">
        <legend>Impossible travel</legend>
        <div className="policy-checks">
          {check('Impossible travel enabled', ['rules', 'impossibleTravel', 'enabled'])}
        </div>
        <div className="policy-field-grid">
          {field('Travel maximum comparison age (seconds)', [
            'rules',
            'impossibleTravel',
            'maxComparisonAgeSeconds',
          ])}
          {field('Travel maximum candidates', ['rules', 'impossibleTravel', 'maxCandidates'])}
          {field('Travel maximum speed (km/h)', ['rules', 'impossibleTravel', 'maxSpeedKmh'])}
          {field('Travel minimum distance (km)', ['rules', 'impossibleTravel', 'minDistanceKm'])}
          {field('Travel allowance (km)', ['rules', 'impossibleTravel', 'travelAllowanceKm'])}
          {field('Travel maximum accuracy (km)', ['rules', 'impossibleTravel', 'maxAccuracyKm'])}
        </div>
        <div className="policy-checks">
          {option('Trusted ATM terminals', 'trustedSources', 'VERIFIED_ATM_TERMINAL')}
          {option('Trusted card terminals', 'trustedSources', 'VERIFIED_CARD_PRESENT_TERMINAL')}
          {option('Eligible ATM transactions', 'eligibleChannels', 'ATM')}
          {option('Eligible card-present transactions', 'eligibleChannels', 'CARD_PRESENT')}
        </div>
      </fieldset>
      {rule(
        'Small payments followed by a large payment',
        'smallPaymentBurstThenLarge',
        'Small payment burst enabled',
        <>
          {field('Burst window (seconds)', [
            'rules',
            'smallPaymentBurstThenLarge',
            'windowSeconds',
          ])}
          {field('Burst minimum small payments', [
            'rules',
            'smallPaymentBurstThenLarge',
            'minSmallPayments',
          ])}
          {currencies.map((code) =>
            field(
              `Small payment maximum (${code})`,
              ['rules', 'smallPaymentBurstThenLarge', 'smallPaymentMaximum', code],
              false,
            ),
          )}
          {currencies.map((code) =>
            field(
              `Large payment threshold (${code})`,
              ['rules', 'smallPaymentBurstThenLarge', 'largePaymentThreshold', code],
              false,
            ),
          )}
        </>,
      )}
    </div>
  );
}
