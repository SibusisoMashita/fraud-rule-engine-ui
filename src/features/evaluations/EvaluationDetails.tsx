import { useEffect, useState } from 'react';
import type { ApiResponse, TransactionResource } from '../../api/client';
import { useSession } from '../../app/session';
import { Failure, Loading } from '../../shared/Feedback';
import { Icon } from '../../shared/Icon';
import { TransactionResult } from '../../shared/TransactionResult';

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
        <TransactionResult result={result} />
      )}
    </section>
  );
}
