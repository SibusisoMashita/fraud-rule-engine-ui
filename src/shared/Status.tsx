const labels: Record<string, string> = {
  CLEAR: 'Clear',
  FLAGGED: 'Flagged',
  INDETERMINATE: 'Indeterminate',
  COMPLETE: 'Complete',
  PARTIAL: 'Partial',
  MATCH: 'Match',
  NO_MATCH: 'No match',
  NOT_APPLICABLE: 'Not applicable',
  INSUFFICIENT_DATA: 'Insufficient data',
  DISABLED: 'Disabled',
};

export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      <span aria-hidden="true" className="status-dot" />
      {labels[value] ?? value}
    </span>
  );
}
