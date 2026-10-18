import { ApiError } from '../api/client';
import { Icon } from './Icon';

export function Failure({ error }: { error: unknown }) {
  const known = error instanceof ApiError;
  return (
    <div role="alert" className="feedback error">
      <Icon name="info" />
      <div>
        <strong>{known ? error.message : 'Something went wrong. Please try again.'}</strong>
        {known && (
          <p className="technical">
            {error.code}
            {error.correlationId && <> · Reference: {error.correlationId}</>}
          </p>
        )}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name="evaluations" />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="loading">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}
