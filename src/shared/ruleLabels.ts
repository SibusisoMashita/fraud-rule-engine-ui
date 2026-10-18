export const ruleLabels: Record<string, { name: string; description: string; number: string }> = {
  HIGH_AMOUNT: {
    number: '01',
    name: 'High amount',
    description: 'A single payment above the configured currency threshold.',
  },
  TRANSACTION_VELOCITY: {
    number: '02',
    name: 'Transaction velocity',
    description: 'Too many transactions within the configured window.',
  },
  CUMULATIVE_SPEND: {
    number: '03',
    name: 'Cumulative spend',
    description: 'Combined spending above the configured window limit.',
  },
  IMPOSSIBLE_TRAVEL: {
    number: '04',
    name: 'Impossible travel',
    description: 'Verified physical transactions too far apart for the elapsed time.',
  },
  SMALL_PAYMENT_BURST_THEN_LARGE: {
    number: '05',
    name: 'Small payment burst',
    description: 'A burst of small payments followed by a large payment.',
  },
};

export function ruleName(id: string) {
  return ruleLabels[id]?.name ?? id;
}

export function fieldLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}
