import { useEffect, useId, useRef } from 'react';
import { ApiError, displayValue } from '../../api/client';
import { useRetrySeconds, useSession } from '../../app/session';
import { Failure, Loading } from '../../shared/Feedback';
import { RawJson } from '../../shared/RawJson';
import { PolicyForm } from './PolicyForm';
import { usePolicyEditor } from './editor';
import { policyChanges } from './model';

export function PolicyEditor() {
  const jsonId = useId();
  const editor = usePolicyEditor();
  const { adminRetryAt } = useSession();
  const seconds = useRetrySeconds(adminRetryAt);
  const cancel = useRef(editor.cancelPending);
  cancel.current = editor.cancelPending;
  useEffect(() => () => cancel.current(), []);
  const busy = editor.phase !== 'idle';
  const unknown = !!editor.uncertain && !editor.uncertain.checked;
  const changes = editor.candidate
    ? policyChanges(editor.candidate.base.data.document, editor.candidate.raw)
    : [];

  return (
    <section
      className="admin-snapshot policy-editor"
      aria-label="Policy editor"
      data-testid="policy-editor"
    >
      <div className="panel-heading policy-editor-heading">
        <div>
          <h3>Administrator policy snapshot</h3>
          <p>Edit the draft, validate it with the engine, then review before activation.</p>
        </div>
        <button
          className="button secondary"
          disabled={busy || seconds > 0}
          onClick={editor.readCurrent}
        >
          Read current policy
        </button>
      </div>
      {seconds > 0 && (
        <p role="status" className="cooldown">
          Please wait {seconds}s before another administrator request.
        </p>
      )}
      {editor.phase === 'reading' && <Loading label="Loading administrator snapshot…" />}
      {editor.error != null &&
        (editor.error instanceof ApiError ? (
          <Failure error={editor.error} />
        ) : (
          <p role="alert">
            {editor.error instanceof Error ? editor.error.message : 'The policy request failed.'}
          </p>
        ))}
      {editor.stale && (
        <p role="status">
          The active revision changed. Your draft is kept. Read current policy, validate again and
          review the changes before activation.
        </p>
      )}
      {unknown && (
        <div className="notice policy-recovery" role="status">
          <p>
            <strong>Activation outcome unknown.</strong> Your draft is kept. Read current policy to
            compare it with the attempted candidate before making another change. The activation
            will not retry automatically.
          </p>
        </div>
      )}
      {editor.recoveryNotice && (
        <p role="status" className="policy-recovery">
          {editor.recoveryNotice}
        </p>
      )}
      {editor.notice && <p role="status">{editor.notice}</p>}
      {editor.snapshot && (
        <>
          <dl className="facts metadata">
            <div>
              <dt>Revision</dt>
              <dd>{displayValue(editor.snapshot.data.revision)}</dd>
            </div>
            <div>
              <dt>ETag</dt>
              <dd>{editor.snapshot.etag ?? 'Not supplied'}</dd>
            </div>
            <div>
              <dt>Policy hash</dt>
              <dd className="hash">{editor.snapshot.data.policyHash}</dd>
            </div>
          </dl>
          {!editor.snapshot.etag && (
            <p role="alert">
              A revision ETag is required for activation. Read current policy before continuing.
            </p>
          )}
          <PolicyForm raw={editor.raw} disabled={busy || unknown} onChange={editor.edit} />
          <details>
            <summary>Advanced policy JSON</summary>
            <div className="policy-json">
              <label htmlFor={jsonId}>Policy JSON</label>
              <textarea
                id={jsonId}
                spellCheck={false}
                value={editor.raw}
                disabled={busy || unknown}
                onChange={(event) => editor.edit(event.target.value)}
              />
            </div>
            <p className="muted">
              This is the same draft as the forms. JSON numbers retain their decimal text; monetary
              amounts remain strings. The engine checks business constraints.
            </p>
          </details>
          <div className="policy-editor-actions">
            <button
              className="button primary"
              disabled={busy || seconds > 0 || unknown || editor.stale}
              onClick={editor.validate}
            >
              Validate draft
            </button>
            {editor.candidate && !editor.reviewed && (
              <button className="button secondary" disabled={busy} onClick={editor.review}>
                Review changes
              </button>
            )}
          </div>
          {editor.phase === 'validating' && <Loading label="Validating draft…" />}
          {editor.candidate && (
            <p role="status">
              Draft validated by the engine.{' '}
              {editor.candidate.hash === editor.candidate.base.data.policyHash
                ? 'The effective policy is unchanged.'
                : 'Review the changes before activation.'}
            </p>
          )}
          {editor.reviewed && editor.candidate && (
            <section className="policy-review" aria-label="Policy change review">
              <h4>Review changes</h4>
              <p>
                These changes apply across the engine. Saved evaluations and replays keep their
                original policy.
              </p>
              <dl className="facts metadata">
                <div>
                  <dt>Base revision ETag</dt>
                  <dd>{editor.candidate.base.etag ?? 'Not supplied'}</dd>
                </div>
                <div>
                  <dt>Validated policy hash</dt>
                  <dd className="hash">{editor.candidate.hash}</dd>
                </div>
              </dl>
              {changes.length > 0 ? (
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Policy changes"
                >
                  <table className="policy-diff">
                    <thead>
                      <tr>
                        <th scope="col">Field</th>
                        <th scope="col">Current base</th>
                        <th scope="col">Draft</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((change) => (
                        <tr key={change.path}>
                          <th scope="row">{change.path}</th>
                          <td>
                            <code>{change.before}</code>
                          </td>
                          <td>
                            <code>{change.after}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No field changes. Activating an unchanged policy preserves its revision.</p>
              )}
              <button
                className="button primary"
                disabled={
                  busy || seconds > 0 || unknown || editor.stale || !editor.candidate.base.etag
                }
                onClick={editor.activate}
              >
                Activate policy
              </button>
            </section>
          )}
          {editor.phase === 'activating' && <Loading label="Activating policy…" />}
          <RawJson raw={editor.snapshot.raw} label="Complete policy document" />
        </>
      )}
    </section>
  );
}
