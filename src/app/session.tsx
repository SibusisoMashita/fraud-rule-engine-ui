import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, createApiClient, type ApiClient } from '../api/client';

interface Session {
  client: ApiClient | null;
  adminClient: ApiClient | null;
  generation: number;
  connecting: boolean;
  adminConnecting: boolean;
  error: unknown;
  adminError: unknown;
  retryAt: number;
  adminRetryAt: number;
  connect: (key: string) => Promise<void>;
  connectAdmin: (key: string) => Promise<void>;
  disconnect: () => void;
  disconnectAdmin: () => void;
}

const Context = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ApiClient | null>(null);
  const [adminClient, setAdminClient] = useState<ApiClient | null>(null);
  const [generation, setGeneration] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [adminConnecting, setAdminConnecting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [adminError, setAdminError] = useState<unknown>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [adminRetryAt, setAdminRetryAt] = useState(0);
  const sequence = useRef(0);
  const adminSequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const pendingAdmin = useRef<AbortController | null>(null);

  function disconnectAdmin() {
    adminSequence.current++;
    pendingAdmin.current?.abort();
    setAdminClient(null);
    setAdminConnecting(false);
    setAdminError(null);
    setAdminRetryAt(0);
  }

  function disconnect() {
    sequence.current++;
    pending.current?.abort();
    setClient(null);
    setConnecting(false);
    setError(null);
    setRetryAt(0);
    setGeneration((value) => value + 1);
    disconnectAdmin();
  }

  async function connect(key: string) {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    const id = ++sequence.current;
    let admitted = false;
    setConnecting(true);
    setError(null);
    const candidate = createApiClient(key, {
      onUnauthorized: () => {
        if (sequence.current !== id || !admitted) return;
        disconnect();
        setError(
          new ApiError('This credential is no longer accepted. Connect with a valid API key.', {
            status: 401,
            code: 'UNAUTHORIZED',
          }),
        );
      },
      onRateLimit: (until) => {
        if (sequence.current === id) setRetryAt(until);
      },
    });
    try {
      await candidate.getEvaluations({ pageSize: 1 }, request.signal);
      if (sequence.current === id) {
        admitted = true;
        setClient(candidate);
        setGeneration((value) => value + 1);
      }
    } catch (failure) {
      // Failed handshake credentials are discarded; a later request cannot clear a newer session.
      if (!request.signal.aborted && sequence.current === id) setError(failure);
    } finally {
      if (sequence.current === id) setConnecting(false);
    }
  }

  async function connectAdmin(key: string) {
    pendingAdmin.current?.abort();
    const request = new AbortController();
    pendingAdmin.current = request;
    const id = ++adminSequence.current;
    let admitted = false;
    setAdminConnecting(true);
    setAdminError(null);
    const candidate = createApiClient(key, {
      onUnauthorized: () => {
        if (adminSequence.current === id && admitted) {
          disconnectAdmin();
          setAdminError(
            new ApiError('This administrator credential is no longer accepted.', {
              status: 401,
              code: 'UNAUTHORIZED',
            }),
          );
        }
      },
      onRateLimit: (until) => {
        if (adminSequence.current === id) setAdminRetryAt(until);
      },
    });
    try {
      await candidate.getEditablePolicy(request.signal);
      if (adminSequence.current === id) {
        admitted = true;
        setAdminClient(candidate);
      }
    } catch (failure) {
      if (!request.signal.aborted && adminSequence.current === id) setAdminError(failure);
    } finally {
      if (adminSequence.current === id) setAdminConnecting(false);
    }
  }

  useEffect(
    () => () => {
      pending.current?.abort();
      pendingAdmin.current?.abort();
    },
    [],
  );

  return (
    <Context
      value={{
        client,
        adminClient,
        generation,
        connecting,
        adminConnecting,
        error,
        adminError,
        retryAt,
        adminRetryAt,
        connect,
        connectAdmin,
        disconnect,
        disconnectAdmin,
      }}
    >
      {children}
    </Context>
  );
}

export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error('SessionProvider is required');
  return value;
}

export function useRetrySeconds(until: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (until <= Date.now()) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}
