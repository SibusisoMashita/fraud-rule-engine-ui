import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, RulesView } from '../../api/client';

function currencyCodes(policy: RulesView): string[] {
  const settings = policy.rules.find((rule) => rule.ruleId === 'HIGH_AMOUNT')?.settings as
    Record<string, unknown> | undefined;
  const thresholds = settings?.thresholds;
  if (
    thresholds === null ||
    typeof thresholds !== 'object' ||
    Array.isArray(thresholds) ||
    Object.keys(thresholds).length === 0 ||
    !Object.entries(thresholds).every(
      ([code, value]) => /^[A-Z]{3}$/.test(code) && typeof value === 'string',
    )
  ) {
    throw new Error(
      'The active policy did not provide supported currencies. Reload policy to try again.',
    );
  }
  return Object.keys(thresholds).sort();
}

interface CurrencyState {
  currencies: string[];
  loading: boolean;
  error: unknown;
}

/** Rule currency maps cover every supported currency, including when the rule is disabled. */
export function useCurrencies(client: ApiClient | null, policyHash?: string) {
  const [state, setState] = useState<CurrencyState>({
    currencies: [],
    loading: false,
    error: null,
  });
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    if (!client) {
      setState({ currencies: [], loading: false, error: null });
      return;
    }
    setState({ currencies: [], loading: true, error: null });
    client
      .getRules(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted)
          setState({ currencies: currencyCodes(response.data), loading: false, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ currencies: [], loading: false, error });
      });
    return () => controller.abort();
  }, [client, policyHash, refresh]);

  return { ...state, reload };
}
