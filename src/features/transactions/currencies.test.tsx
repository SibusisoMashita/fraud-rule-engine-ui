import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiClient } from '../../api/client';
import { useCurrencies } from './currencies';

let fetchMock: ReturnType<typeof vi.fn>;
const client = createApiClient('synthetic.currency-test');

function response(thresholds: unknown = { ZAR: '25000.00', USD: '1000.00' }, enabled = true) {
  return new Response(
    JSON.stringify({
      policyHash: 'a'.repeat(64),
      rules: [{ ruleId: 'HIGH_AMOUNT', algorithmVersion: '1', enabled, settings: { thresholds } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function pending() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(response());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('transaction currencies', () => {
  it('does not invent currencies or send a request without a connection', () => {
    const { result } = renderHook(() => useCurrencies(null));
    expect(result.current).toMatchObject({ currencies: [], loading: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'uses the complete rule currency map when enabled is %s',
    async (enabled) => {
      fetchMock.mockResolvedValue(response({ ZAR: '25000.00', EUR: '1000.00' }, enabled));
      const { result } = renderHook(() => useCurrencies(client));
      await waitFor(() => expect(result.current.currencies).toEqual(['EUR', 'ZAR']));
      expect(result.current).toMatchObject({ loading: false, error: null });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/rules');
    },
  );

  it.each([null, {}, [], { zar: '100' }, { ZAR: 100 }])(
    'shows an error instead of fallback currencies for an invalid map: %j',
    async (thresholds) => {
      fetchMock.mockResolvedValue(response(thresholds));
      const { result } = renderHook(() => useCurrencies(client));
      await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
      expect(result.current.currencies).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('handles missing high-amount metadata without inventing a supported currency', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ policyHash: 'a'.repeat(64), rules: [] })),
    );
    const { result } = renderHook(() => useCurrencies(client));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.currencies).toEqual([]);
  });

  it('keeps a failed read visible until an explicit reload succeeds', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"code":"FORBIDDEN"}', { status: 403 }));
    const { result } = renderHook(() => useCurrencies(client));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.currencies).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.currencies).toEqual(['USD', 'ZAR']));
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts a replaced read and ignores its late response after reload', async () => {
    const oldRead = pending();
    fetchMock.mockReturnValueOnce(oldRead.promise);
    const { result } = renderHook(() => useCurrencies(client));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.currencies).toEqual(['USD', 'ZAR']));
    expect(signal.aborted).toBe(true);
    await act(async () => oldRead.resolve(response({ GBP: '1000.00' })));
    expect(result.current.currencies).toEqual(['USD', 'ZAR']);
  });

  it('clears currencies on disconnect and ignores the old connection response', async () => {
    const oldRead = pending();
    fetchMock.mockReturnValueOnce(oldRead.promise);
    const { result, rerender } = renderHook(
      ({ connection }: { connection: ApiClient | null }) => useCurrencies(connection),
      { initialProps: { connection: client as ApiClient | null } },
    );
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    rerender({ connection: null });
    expect(signal.aborted).toBe(true);
    await act(async () => oldRead.resolve(response()));
    expect(result.current).toMatchObject({ currencies: [], loading: false, error: null });
  });

  it('uses the replacement connection and ignores the previous connection response', async () => {
    const oldRead = pending();
    fetchMock.mockReturnValueOnce(oldRead.promise);
    const { result, rerender } = renderHook(({ connection }) => useCurrencies(connection), {
      initialProps: { connection: client },
    });
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    rerender({ connection: createApiClient('synthetic.replacement-connection') });
    await waitFor(() => expect(result.current.currencies).toEqual(['USD', 'ZAR']));
    expect(signal.aborted).toBe(true);
    await act(async () => oldRead.resolve(response({ GBP: '1000.00' })));
    expect(result.current.currencies).toEqual(['USD', 'ZAR']);
  });

  it('aborts a read when unmounted', () => {
    fetchMock.mockReturnValueOnce(pending().promise);
    const { unmount } = renderHook(() => useCurrencies(client));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('reloads currencies when a known active policy hash changes', async () => {
    const { result, rerender } = renderHook(({ hash }) => useCurrencies(client, hash), {
      initialProps: { hash: 'a'.repeat(64) },
    });
    await waitFor(() => expect(result.current.currencies).toEqual(['USD', 'ZAR']));
    fetchMock.mockResolvedValue(response({ ZAR: '30000.00' }));
    rerender({ hash: 'b'.repeat(64) });
    await waitFor(() => expect(result.current.currencies).toEqual(['ZAR']));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
