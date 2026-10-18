const paths = {
  evaluations: 'M8 3h8l4 4v14H4V3h4m8 0v5h4M8 12h8M8 16h5',
  transactions: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
  policy: 'M4 6h16M4 12h16M4 18h16M9 3v6m6 0v6m-6 0v6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  refresh: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10m7 5v2',
  shield: 'M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7l-9-4Zm-4 9 3 3 5-6',
  chevron: 'm9 5 7 7-7 7',
  close: 'm6 6 12 12M6 18 18 6',
  info: 'M12 11v6m0-10v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
} as const;

export function Icon({ name, className = '' }: { name: keyof typeof paths; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
