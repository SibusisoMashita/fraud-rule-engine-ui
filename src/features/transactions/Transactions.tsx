import { useEffect, useState } from 'react';
import { useRetrySeconds, useSession } from '../../app/session';
import { Failure } from '../../shared/Feedback';
import { Icon } from '../../shared/Icon';
import { RawJson } from '../../shared/RawJson';
import { TransactionResult } from '../../shared/TransactionResult';
import { scenarioPresets } from './model';
import { usePlayground, type Submission } from './playground';
import { TransactionForm } from './TransactionForm';
import { AmountInput } from './AmountInput';
import { useCurrencies } from './currencies';
import { usePolicyEditor } from '../policy/editor';

function outcome(item: Submission) {
  if (item.outcome === 'UNKNOWN') return item.saved ? 'Replay response unknown' : 'Outcome unknown';
  return { SENDING: 'Sending', SAVED: 'Saved', REJECTED: 'Rejected', NOT_SENT: 'Not sent' }[
    item.outcome
  ];
}

export function Transactions() {
  const { client, retryAt } = useSession();
  const { snapshot } = usePolicyEditor();
  const currencies = useCurrencies(client, snapshot?.data.policyHash);
  const playground = usePlayground();
  const seconds = useRetrySeconds(retryAt);
  const [conflictAmount, setConflictAmount] = useState('');
  useEffect(() => () => playground.stop(), []);
  const { plan, selected, busy, started } = playground;
  const blocked = !client || busy || seconds > 0;
  const unsupportedSteps =
    currencies.currencies.length > 0
      ? plan.transactions.flatMap((draft, index) =>
          currencies.currencies.includes(draft.currency) ? [] : [index + 1],
        )
      : [];
  const currencyUnavailable =
    currencies.loading || currencies.currencies.length === 0 || unsupportedSteps.length > 0;
  const result = selected?.retrieved ?? selected?.saved;

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Test a scenario. Follow the evidence.</p>
          <h2>Try transactions</h2>
          <p>Submit synthetic transactions and see the engine’s actual decisions.</p>
        </div>
        <button
          className="button secondary"
          disabled={busy || playground.unresolved}
          onClick={() => playground.choose()}
        >
          New transaction
          <Icon name="transactions" />
        </button>
      </header>
      {playground.unresolved && (
        <p className="recovery-note" role="status">
          Resolve the uncertain submission below before starting another run.
        </p>
      )}
      <section className="scenario-panel" aria-labelledby="scenario-heading">
        <div className="panel-heading">
          <h3 id="scenario-heading">Five example scenarios</h3>
          <span className="read-only-label">Editable examples</span>
        </div>
        <p className="muted">
          Preset values illustrate the sample policy. They do not decide the result; changing live
          policy can change the outcome.
        </p>
        <div className="scenario-choices">
          {scenarioPresets.map((preset) => (
            <button
              key={preset.id}
              className={`scenario-choice ${plan.id === preset.id ? 'chosen' : ''}`}
              aria-pressed={plan.id === preset.id}
              disabled={busy || playground.unresolved}
              onClick={() => playground.choose(preset.id)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </section>
      {seconds > 0 && (
        <p role="status" className="cooldown">
          Please wait {seconds}s before another request. Requests do not retry automatically.
        </p>
      )}
      <section className="transaction-editor" aria-labelledby="transaction-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              {plan.id === 'MANUAL'
                ? 'One transaction'
                : `${plan.transactions.length} transactions · sent in order`}
            </p>
            <h3 id="transaction-heading">{plan.name}</h3>
            <p className="muted">{plan.description}</p>
          </div>
          {started && <span className="read-only-label">Submitted payloads retained</span>}
        </div>
        {plan.transactions.length > 1 && (
          <div className="step-choices" role="group" aria-label="Scenario transactions">
            {plan.transactions.map((draft, index) => (
              <button
                type="button"
                key={index}
                className={`step-choice ${playground.editing === index ? 'chosen' : ''}`}
                aria-pressed={playground.editing === index}
                onClick={() => playground.setEditing(index)}
                disabled={busy}
              >
                <span>Edit transaction {index + 1}:</span>{' '}
                <span>
                  {draft.currency} {draft.amount}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="editor-actions">
          <p className="muted">Currencies come from the engine’s active policy.</p>
          <button
            type="button"
            className="button secondary"
            disabled={!client || busy || currencies.loading || seconds > 0}
            onClick={currencies.reload}
          >
            Reload currencies
          </button>
        </div>
        {currencies.error != null && <Failure error={currencies.error} />}
        {unsupportedSteps.length > 0 && !started && (
          <p role="status" className="field-error">
            Choose an active currency for transaction steps {unsupportedSteps.join(', ')} before
            sending.
          </p>
        )}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void playground.run();
          }}
        >
          <TransactionForm
            draft={plan.transactions[playground.editing]}
            disabled={busy || started}
            currencies={currencies.currencies}
            loadingCurrencies={currencies.loading}
            onChange={playground.edit}
          />
          {playground.validation && !started && (
            <p className="field-error" role="alert">
              {playground.validation}
            </p>
          )}
          <div className="editor-actions">
            <p className="muted">
              {started
                ? 'Start a new transaction or scenario run to edit fresh identifiers.'
                : 'Review every step before sending. A failed or uncertain response stops the run.'}
            </p>
            <div className="button-row">
              {busy ? (
                <button type="button" className="button secondary" onClick={playground.stop}>
                  Stop run
                </button>
              ) : started && plan.id !== 'MANUAL' ? (
                <button
                  type="button"
                  className="button secondary"
                  disabled={playground.unresolved}
                  onClick={() => playground.choose(plan.id === 'MANUAL' ? undefined : plan.id)}
                >
                  New scenario run
                </button>
              ) : null}
              <button
                className="button primary"
                disabled={blocked || currencyUnavailable || started || playground.unresolved}
              >
                {busy ? 'Sending…' : plan.id === 'MANUAL' ? 'Submit transaction' : 'Run scenario'}
                <Icon name="arrow" />
              </button>
            </div>
          </div>
        </form>
      </section>
      {playground.submissions.length > 0 && (
        <section className="submission-history" aria-labelledby="submission-heading">
          <h3 id="submission-heading">Submission history</h3>
          <ol aria-label="Submission history">
            {playground.submissions.map((item, index) => (
              <li key={item.id}>
                <button
                  className={`history-item ${selected?.id === item.id ? 'chosen' : ''}`}
                  aria-pressed={selected?.id === item.id}
                  disabled={busy}
                  onClick={() => {
                    playground.select(item.id);
                    setConflictAmount('');
                  }}
                >
                  <span className="history-event">
                    View submission {index + 1}: {item.eventId}
                  </span>{' '}
                  <span
                    className={`status ${item.outcome === 'SAVED' ? 'status-clear' : item.outcome === 'UNKNOWN' ? 'status-partial' : ''}`}
                  >
                    {outcome(item)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      {selected && (
        <section
          className="transaction-response"
          aria-labelledby="response-heading"
          data-testid="transaction-result"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{selected.operation}</p>
              <h3 id="response-heading">{outcome(selected)}</h3>
            </div>
            {result && <span className="status">HTTP {result.status}</span>}
          </div>
          {(selected.outcome === 'UNKNOWN' ||
            (selected.outcome === 'SENDING' && selected.operation !== 'Conflicting duplicate')) && (
            <p className="recovery-note">
              The request may have committed. Keep this event ID and exact payload. Retrieve the
              saved transaction or replay this payload explicitly; a temporary 404 does not prove
              the request failed.
            </p>
          )}
          {selected.error != null && <Failure error={selected.error} />}
          {playground.notice && (
            <p role="status" className="notice-text">
              {playground.notice}
            </p>
          )}
          <RawJson raw={selected.raw} label="Retained request payload" />
          <div className="button-row recovery-actions">
            <button
              className="button secondary"
              disabled={blocked}
              onClick={() => void playground.retrieve()}
            >
              Retrieve saved result
            </button>
            <button
              className="button secondary"
              disabled={blocked}
              onClick={() => void playground.replay()}
            >
              {selected.outcome === 'UNKNOWN' && !selected.saved
                ? 'Replay uncertain transaction'
                : 'Replay identical payload'}
            </button>
          </div>
          {selected.saved && (
            <form
              className="conflict-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void playground.conflict(conflictAmount);
              }}
            >
              <AmountInput
                label="Conflicting amount"
                value={conflictAmount}
                onChange={setConflictAmount}
                placeholder="A different amount"
                disabled={blocked || playground.unresolved}
              />
              <button
                className="button secondary"
                disabled={blocked || playground.unresolved || !conflictAmount.trim()}
              >
                Conflicting duplicate
              </button>
              <p className="muted">
                Send a changed amount under the same event ID to see the API reject conflicting
                content. The original result remains stored.
              </p>
              {playground.validation && (
                <p className="field-error" role="alert">
                  {playground.validation}
                </p>
              )}
            </form>
          )}
          {result && <TransactionResult result={result} />}
        </section>
      )}
    </>
  );
}
