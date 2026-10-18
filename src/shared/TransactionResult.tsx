import { displayValue, type ApiResponse, type TransactionResource } from '../api/client';
import { RawJson } from './RawJson';
import { Status } from './Status';
import { fieldLabel, ruleName } from './ruleLabels';

export function TransactionResult({ result }: { result: ApiResponse<TransactionResource> }) {
  return (
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
  );
}
