import { useEffect, useState, type FormEvent } from 'react';
import type { ApiResponse, EvaluationFilters, EvaluationPage } from '../../api/client';
import { useRetrySeconds, useSession } from '../../app/session';
import { Empty, Failure, Loading } from '../../shared/Feedback';
import { Icon } from '../../shared/Icon';
import { Status } from '../../shared/Status';
import { EvaluationDetails } from './EvaluationDetails';

const initialDraft = {
  customerId: '',
  decision: '',
  acceptedFrom: '',
  acceptedTo: '',
  pageSize: '',
};

export function Evaluations() {
  const { client, retryAt } = useSession();
  const seconds = useRetrySeconds(retryAt);
  const [draft, setDraft] = useState(initialDraft);
  const [filters, setFilters] = useState<EvaluationFilters>({});
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [index, setIndex] = useState(0);
  const [page, setPage] = useState<ApiResponse<EvaluationPage> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filterError, setFilterError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const cursor = cursors[index];

  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setPage(null);
    setSelected(null);
    client
      .getEvaluations({ ...filters, ...(cursor ? { cursor } : {}) }, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setPage(response);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, filters, cursor, refresh]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setFilterError('');
    const next: EvaluationFilters = {};
    if (draft.customerId.trim()) next.customerId = draft.customerId.trim();
    if (draft.decision) next.decision = draft.decision as EvaluationFilters['decision'];
    for (const key of ['acceptedFrom', 'acceptedTo'] as const) {
      if (!draft[key].trim()) continue;
      if (!/^\d{4}-\d\d-\d\dT/.test(draft[key]) || !Number.isFinite(Date.parse(draft[key]))) {
        setFilterError('Use a complete ISO timestamp, including Z or a timezone offset.');
        return;
      }
      if (!/(Z|[+-]\d\d:\d\d)$/.test(draft[key])) {
        setFilterError('Include Z or a timezone offset in each timestamp.');
        return;
      }
      next[key] = draft[key].trim();
    }
    if (
      next.acceptedFrom &&
      next.acceptedTo &&
      (Date.parse(next.acceptedFrom) > Date.parse(next.acceptedTo) ||
        next.acceptedFrom === next.acceptedTo)
    ) {
      setFilterError('Accepted from must be earlier than accepted to.');
      return;
    }
    if (draft.pageSize) next.pageSize = Number(draft.pageSize);
    setCursors([undefined]);
    setIndex(0);
    setFilters(next);
  }

  function reset() {
    setDraft(initialDraft);
    setFilterError('');
    setFilters({});
    setCursors([undefined]);
    setIndex(0);
  }
  function nextPage() {
    if (!page?.data.nextCursor) return;
    setCursors((previous) => [...previous.slice(0, index + 1), page.data.nextCursor]);
    setIndex((value) => value + 1);
  }

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">The decisions behind the data</p>
          <h2>Evaluations</h2>
          <p>Browse saved decisions. Open a transaction to follow the evidence.</p>
        </div>
        <button
          className="button secondary"
          disabled={!client || loading || seconds > 0}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <Icon name="refresh" />
          Refresh evaluations
        </button>
      </header>
      {!client ? (
        <div className="preview-card">
          <div className="preview-graphic" aria-hidden="true">
            <Icon name="evaluations" />
            <span />
            <span />
            <span />
          </div>
          <div>
            <p className="eyebrow">A clear view of every result</p>
            <h3>From transaction to explanation.</h3>
            <p>
              Once connected, filter persisted evaluations and inspect each rule’s outcome, evidence
              and policy version.
            </p>
            <div className="preview-tags">
              <span>Actual API results</span>
              <span>Full decimal precision</span>
              <span>Saved history</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <form className="filter-panel" onSubmit={apply} aria-label="Evaluation filters">
            <div className="filter-grid">
              <label>
                Customer ID
                <input
                  value={draft.customerId}
                  onChange={(event) => setDraft({ ...draft, customerId: event.target.value })}
                  maxLength={128}
                  placeholder="All customers"
                />
              </label>
              <label>
                Decision
                <select
                  value={draft.decision}
                  onChange={(event) => setDraft({ ...draft, decision: event.target.value })}
                >
                  <option value="">All decisions</option>
                  <option value="CLEAR">Clear</option>
                  <option value="FLAGGED">Flagged</option>
                  <option value="INDETERMINATE">Indeterminate</option>
                </select>
              </label>
              <label>
                Accepted from
                <input
                  value={draft.acceptedFrom}
                  onChange={(event) => setDraft({ ...draft, acceptedFrom: event.target.value })}
                  placeholder="ISO timestamp with timezone"
                />
              </label>
              <label>
                Accepted to
                <input
                  value={draft.acceptedTo}
                  onChange={(event) => setDraft({ ...draft, acceptedTo: event.target.value })}
                  placeholder="ISO timestamp with timezone"
                />
              </label>
              <label>
                Page size
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={draft.pageSize}
                  placeholder="Default"
                  onChange={(event) => setDraft({ ...draft, pageSize: event.target.value })}
                />
              </label>
            </div>
            <div className="filter-footer">
              <p>Dates filter acceptance time. Without dates, the API uses its default window.</p>
              <div className="button-row">
                <button
                  type="button"
                  className="text-button"
                  onClick={reset}
                  disabled={loading || seconds > 0}
                >
                  Clear filters
                </button>
                <button className="button primary" disabled={loading || seconds > 0}>
                  Apply filters
                </button>
              </div>
            </div>
            {filterError && (
              <p role="alert" className="field-error">
                {filterError}
              </p>
            )}
          </form>
          {seconds > 0 && (
            <p role="status" className="cooldown">
              Please wait {seconds}s before another request. Requests do not retry automatically.
            </p>
          )}
          <section className="results-panel" aria-label="Saved evaluations">
            {loading ? (
              <Loading label="Loading evaluations…" />
            ) : error != null ? (
              <Failure error={error} />
            ) : page && page.data.items.length === 0 ? (
              <Empty title="No evaluations found">
                Try another customer or a wider acceptance-time window.
              </Empty>
            ) : (
              page && (
                <>
                  <div className="results-heading">
                    <h3>Saved evaluations</h3>
                    <p>{page.data.items.length} on this page</p>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Event</th>
                          <th scope="col">Decision</th>
                          <th scope="col">Coverage</th>
                          <th scope="col">Accepted at</th>
                          <th scope="col">
                            <span className="sr-only">Details</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.data.items.map((item) => (
                          <tr key={item.id}>
                            <td className="event-id">{item.eventId}</td>
                            <td>
                              <Status value={item.decision} />
                            </td>
                            <td>
                              <Status value={item.coverage} />
                            </td>
                            <td>
                              <time dateTime={item.acceptedAt}>
                                {new Date(item.acceptedAt).toLocaleString('en-ZA', {
                                  dateStyle: 'medium',
                                  timeStyle: 'medium',
                                })}
                              </time>
                            </td>
                            <td>
                              <button
                                className="table-action"
                                onClick={() => setSelected(item.eventId)}
                                disabled={seconds > 0}
                              >
                                View details
                                <Icon name="chevron" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            )}
            <div className="pagination">
              <span>Page {index + 1} · Live cursor pagination</span>
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={index === 0 || loading || seconds > 0}
                  onClick={() => setIndex((value) => value - 1)}
                >
                  Previous page
                </button>
                <button
                  className="button secondary"
                  disabled={!page?.data.nextCursor || loading || seconds > 0}
                  onClick={nextPage}
                >
                  Next page
                  <Icon name="arrow" />
                </button>
              </div>
            </div>
          </section>
          {selected && (
            <EvaluationDetails
              key={selected}
              eventId={selected}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}
    </>
  );
}
