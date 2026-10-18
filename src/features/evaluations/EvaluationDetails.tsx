import { useEffect, useState } from 'react';
import { displayValue, type ApiResponse, type TransactionResource } from '../../api/client';
import { useSession } from '../../app/session';
import { Failure, Loading } from '../../shared/Feedback';
import { RawJson } from '../../shared/RawJson';
import { Status } from '../../shared/Status';
import { fieldLabel, ruleName } from '../../shared/ruleLabels';
import { Icon } from '../../shared/Icon';

export function EvaluationDetails({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { client } = useSession();
  const [result, setResult] = useState<ApiResponse<TransactionResource> | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    setResult(null);
    setError(null);
    client
      .getTransaction(eventId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setResult(response);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      });
    return () => controller.abort();
  }, [client, eventId]);

  return (
    <section
      className="details-panel"
      aria-labelledby="detail-heading"
      data-testid="evaluation-details"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Saved transaction</p>
          <h2 id="detail-heading">Evaluation details</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close details">
          <Icon name="close" />
        </button>
      </div>
      {error != null ? (
        <Failure error={error} />
      ) : !result ? (
        <Loading label="Loading transaction details…" />
      ) : (
        <>
          <div className="decision-strip">
            <Status value={result.data.evaluation.decision} />
            <Status value={result.data.evaluation.coverage} />
            <span className="amount">
              {result.data.transaction.currency} {result.data.transaction.amount}
            </span>
          </div>
          <dl className="facts transaction-facts">
            {Object.entries(result.data.transaction)
              .filter(([key]) => key !== 'physicalLocation')
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{fieldLabel(key)}</dt>
                  <dd>{displayValue(value)}</dd>
                </div>
              ))}
          </dl>
          {result.data.transaction.physicalLocation && (
            <details className="location-facts">
              <summary>Submitted location</summary>
              <dl className="facts">
                {Object.entries(result.data.transaction.physicalLocation).map(([key, value]) => (
                  <div key={key}>
                    <dt>{fieldLabel(key)}</dt>
                    <dd>{displayValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <h3 className="section-label">Rule results</h3>
          <p className="muted">
            A match flags a possible concern. It is not a confirmed fraud verdict.
          </p>
          <div className="rule-results">
            {result.data.evaluation.ruleResults.map((rule) => (
              <article className="rule-result" key={rule.ruleId}>
                <div className="inline-between">
                  <h4>{ruleName(rule.ruleId)}</h4>
                  <Status value={rule.status} />
                </div>
                <p className="technical">
                  {rule.reasonCode} · Algorithm {rule.algorithmVersion}
                </p>
                <dl className="facts evidence">
                  {Object.entries(rule.evidence).map(([key, value]) => (
                    <div key={key}>
                      <dt>{fieldLabel(key)}</dt>
                      <dd>{displayValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
          <dl className="facts metadata">
            <div>
              <dt>Policy hash</dt>
              <dd className="hash">{result.data.evaluation.policyHash}</dd>
            </div>
            <div>
              <dt>Build</dt>
              <dd>{result.data.evaluation.buildId}</dd>
            </div>
            <div>
              <dt>Evaluation ID</dt>
              <dd>{result.data.evaluation.id}</dd>
            </div>
            <div>
              <dt>Accepted at</dt>
              <dd>{result.data.evaluation.acceptedAt}</dd>
            </div>
            <div>
              <dt>Evaluated at</dt>
              <dd>{result.data.evaluation.evaluatedAt}</dd>
            </div>
            <div>
              <dt>History watermark</dt>
              <dd>{displayValue(result.data.evaluation.contextHighWatermark)}</dd>
            </div>
          </dl>
          <RawJson raw={result.raw} />
        </>
      )}
    </section>
  );
}
