import { prettyJson } from '../api/client';

export function RawJson({ raw, label = 'Raw API response' }: { raw: string; label?: string }) {
  return (
    <details className="raw-json">
      <summary>{label}</summary>
      <pre tabIndex={0} aria-label={label}>
        {prettyJson(raw)}
      </pre>
    </details>
  );
}
