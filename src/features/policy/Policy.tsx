import { useEffect, useState } from 'react';
import { isLosslessNumber } from 'lossless-json';
import {
  displayValue,
  type ApiResponse,
  type EditablePolicy,
  type RulesView,
} from '../../api/client';
import { AdministratorConnection } from '../../app/Connection';
import { useRetrySeconds, useSession } from '../../app/session';
import { Empty, Failure, Loading } from '../../shared/Feedback';
import { Icon } from '../../shared/Icon';
import { RawJson } from '../../shared/RawJson';
import { fieldLabel, ruleLabels, ruleName } from '../../shared/ruleLabels';

function Settings({ settings }: { settings: object }) {
  return (
    <dl className="facts policy-settings">
      {Object.entries(settings)
        .filter(([name]) => name !== 'enabled')
        .map(([name, value]) => (
          <div key={name}>
            <dt>{fieldLabel(name)}</dt>
            <dd>
              {Array.isArray(value) ? (
                value.map(displayValue).join(', ')
              ) : value !== null && typeof value === 'object' && !isLosslessNumber(value) ? (
                <dl className="nested-facts">
                  {Object.entries(value).map(([currency, threshold]) => (
                    <div key={currency}>
                      <dt>{currency}</dt>
                      <dd>{displayValue(threshold)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                displayValue(value)
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}

export function Policy() {
  const { client, adminClient, retryAt, adminRetryAt } = useSession();
  const seconds = useRetrySeconds(retryAt);
  const adminSeconds = useRetrySeconds(adminRetryAt);
  const [rules, setRules] = useState<ApiResponse<RulesView> | null>(null);
  const [document, setDocument] = useState<ApiResponse<EditablePolicy> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adminError, setAdminError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [adminRefresh, setAdminRefresh] = useState(0);

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setRules(null);
    client
      .getRules(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setRules(response);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, refresh]);

  useEffect(() => {
    setDocument(null);
    setAdminError(null);
    if (!adminClient) return;
    const controller = new AbortController();
    adminClient
      .getEditablePolicy(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setDocument(response);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setAdminError(failure);
      });
    return () => controller.abort();
  }, [adminClient, adminRefresh]);

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">The engine’s current settings</p>
          <h2>Policy</h2>
          <p>Inspect active rules. New transactions use live policy without a restart.</p>
        </div>
        <button
          className="button secondary"
          disabled={!client || loading || seconds > 0}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <Icon name="refresh" />
          Reload policy
        </button>
      </header>
      {!client ? (
        <section className="results-panel">
          <Empty title="Connect to inspect policy">
            The engine will return its active rules and policy hash.
          </Empty>
        </section>
      ) : (
        <>
          {seconds > 0 && (
            <p role="status" className="cooldown">
              Please wait {seconds}s before another request. Requests do not retry automatically.
            </p>
          )}
          {loading ? (
            <Loading label="Loading active policy…" />
          ) : error != null ? (
            <Failure error={error} />
          ) : (
            rules && (
              <>
                <div className="policy-banner">
                  <span className="connection-symbol">
                    <Icon name="shield" />
                  </span>
                  <div>
                    <p className="eyebrow">Active policy hash</p>
                    <p className="hash">{rules.data.policyHash}</p>
                  </div>
                  <span className="read-only-label">Read-only</span>
                </div>
                <div className="policy-grid">
                  {[...rules.data.rules]
                    .sort((left, right) =>
                      (ruleLabels[left.ruleId]?.number ?? left.ruleId).localeCompare(
                        ruleLabels[right.ruleId]?.number ?? right.ruleId,
                      ),
                    )
                    .map((rule, index) => (
                      <article key={rule.ruleId} className="policy-card">
                        <div className="inline-between">
                          <span className="rule-number">
                            {ruleLabels[rule.ruleId]?.number ?? String(index + 1).padStart(2, '0')}
                          </span>
                          <span
                            className={`status ${rule.enabled ? 'status-clear' : 'status-disabled'}`}
                          >
                            {rule.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                        <h3>{ruleName(rule.ruleId)}</h3>
                        <p className="rule-description">
                          {ruleLabels[rule.ruleId]?.description ??
                            'Rule settings returned by the engine.'}
                        </p>
                        <Settings settings={rule.settings} />
                        <div className="policy-card-footer">
                          <code>{rule.ruleId}</code>
                          <span>Algorithm {rule.algorithmVersion}</span>
                        </div>
                      </article>
                    ))}
                </div>
                <RawJson raw={rules.raw} />
              </>
            )
          )}
          <div className="notice">
            <Icon name="info" />
            <p>
              Policy applies across the engine. Saved evaluations keep their original policy and
              result. Editing and activation will arrive in the policy-editor milestone.
            </p>
          </div>
          <AdministratorConnection />
          {adminClient && (
            <section className="admin-snapshot">
              <div className="panel-heading">
                <h3>Administrator policy snapshot</h3>
                <button
                  className="button secondary"
                  disabled={adminSeconds > 0}
                  onClick={() => setAdminRefresh((value) => value + 1)}
                >
                  Refresh administrator snapshot
                </button>
              </div>
              {adminSeconds > 0 && (
                <p className="cooldown">
                  Please wait {adminSeconds}s before another administrator request.
                </p>
              )}
              {adminError != null ? (
                <Failure error={adminError} />
              ) : !document ? (
                <Loading label="Loading administrator snapshot…" />
              ) : (
                <>
                  <dl className="facts metadata">
                    <div>
                      <dt>Revision</dt>
                      <dd>{displayValue(document.data.revision)}</dd>
                    </div>
                    <div>
                      <dt>ETag</dt>
                      <dd>{document.etag ?? 'Not supplied'}</dd>
                    </div>
                    <div>
                      <dt>Policy hash</dt>
                      <dd className="hash">{document.data.policyHash}</dd>
                    </div>
                  </dl>
                  <RawJson raw={document.raw} label="Complete policy document" />
                </>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
