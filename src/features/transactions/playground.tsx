import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, type ApiResponse, type TransactionResource } from '../../api/client';
import { useSession } from '../../app/session';
import {
  conflictingPayload,
  createManualDraft,
  createScenarioDraft,
  serializeDraft,
  refreshEventTimes,
  normalizeAmountEntry,
  type ScenarioDraft,
  type ScenarioId,
  type TransactionDraft,
} from './model';

type Outcome = 'SENDING' | 'SAVED' | 'REJECTED' | 'UNKNOWN' | 'NOT_SENT';
export interface Submission {
  id: string;
  eventId: string;
  raw: string;
  operation: 'Submit' | 'Replay' | 'Conflicting duplicate';
  outcome: Outcome;
  saved?: ApiResponse<TransactionResource>;
  retrieved?: ApiResponse<TransactionResource>;
  error?: unknown;
}

type PlaygroundPlan = Omit<ScenarioDraft, 'id'> & { id: ScenarioId | 'MANUAL' };

function manual(): PlaygroundPlan {
  return {
    id: 'MANUAL',
    name: 'Your transaction',
    description: 'Submit one synthetic transaction.',
    transactions: [createManualDraft()],
  };
}

function usePlaygroundState() {
  const { client, retryAt } = useSession();
  const [plan, setPlan] = useState<PlaygroundPlan>(manual);
  const [editing, setEditing] = useState(0);
  const [started, setStarted] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const working = useRef(false);
  const mounted = useRef(true);
  const unresolved = submissions.some((item) => item.outcome === 'UNKNOWN' && !item.saved);
  const selected = submissions.find((item) => item.id === selectedId);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  function stop() {
    controller.current?.abort();
  }

  function update(id: string, change: Partial<Submission>) {
    if (mounted.current)
      setSubmissions((items) =>
        items.map((item) => (item.id === id ? { ...item, ...change } : item)),
      );
  }

  function choose(id?: ScenarioId) {
    if (working.current || unresolved) return;
    setPlan(id ? createScenarioDraft(id) : manual());
    setEditing(0);
    setStarted(false);
    setSubmissions([]);
    setSelectedId(null);
    setValidation('');
    setNotice('');
  }

  function edit(draft: TransactionDraft) {
    if (working.current || started) return;
    setPlan((previous) => ({
      ...previous,
      transactions: previous.transactions.map((value, index) =>
        index === editing ? draft : value,
      ),
    }));
    setValidation('');
  }

  function begin() {
    if (!client || working.current || retryAt > Date.now()) return null;
    working.current = true;
    setBusy(true);
    setNotice('');
    setValidation('');
    const request = new AbortController();
    controller.current = request;
    return request;
  }

  function finish() {
    working.current = false;
    if (mounted.current) setBusy(false);
  }

  async function send(item: Submission, signal: AbortSignal): Promise<boolean> {
    if (!client) return false;
    update(item.id, { outcome: 'SENDING', error: undefined, retrieved: undefined });
    try {
      const response = await client.submitTransaction(item.raw, signal);
      update(item.id, { outcome: 'SAVED', saved: response });
      return true;
    } catch (error) {
      const outcome = error instanceof ApiError ? error.outcome : undefined;
      // A pre-dispatch cooldown/abort leaves a previous result or uncertainty intact.
      const fallback = item.outcome === 'SENDING' ? 'NOT_SENT' : item.outcome;
      // A rejected retry cannot disprove an earlier commit. Only an explicit conflict
      // settles that this retained payload does not own the stored event ID.
      const stillUnknown =
        item.outcome === 'UNKNOWN' &&
        !item.saved &&
        !(error instanceof ApiError && error.status === 409);
      update(item.id, { outcome: stillUnknown ? 'UNKNOWN' : (outcome ?? fallback), error });
      return false;
    }
  }

  async function run() {
    if (started || unresolved) return;
    let prepared: Submission[];
    let transactions: TransactionDraft[];
    try {
      transactions = refreshEventTimes(plan.transactions).map((draft) => ({
        ...draft,
        amount: normalizeAmountEntry(draft.amount),
      }));
      prepared = transactions.map((draft, index) => {
        try {
          return {
            id: crypto.randomUUID(),
            eventId: draft.eventId,
            raw: serializeDraft(draft),
            operation: 'Submit',
            outcome: 'SENDING',
          };
        } catch (error) {
          throw new Error(
            `Transaction ${index + 1}: ${error instanceof Error ? error.message : 'check the fields.'}`,
          );
        }
      });
    } catch (error) {
      setValidation(error instanceof Error ? error.message : 'Check the transaction fields.');
      return;
    }
    const request = begin();
    if (!request) return;
    setPlan((previous) => ({ ...previous, transactions }));
    setStarted(true);
    setValidation('');
    try {
      for (const item of prepared) {
        if (request.signal.aborted || !mounted.current) break;
        // Retain immutable request text before dispatch; never rebuild a replay from a form.
        setSubmissions((items) => [...items, item]);
        setSelectedId(item.id);
        if (!(await send(item, request.signal))) break;
      }
    } finally {
      finish();
    }
  }

  async function replay() {
    if (!selected) return;
    const request = begin();
    if (!request) return;
    update(selected.id, { operation: 'Replay' });
    try {
      await send(selected, request.signal);
    } finally {
      finish();
    }
  }

  async function conflict(amount: string) {
    if (!selected?.saved || unresolved) return;
    let raw: string;
    try {
      raw = conflictingPayload(selected.raw, normalizeAmountEntry(amount.trim()));
    } catch (error) {
      setValidation(error instanceof Error ? error.message : 'Check the conflicting amount.');
      return;
    }
    const item: Submission = {
      id: crypto.randomUUID(),
      eventId: selected.eventId,
      raw,
      operation: 'Conflicting duplicate',
      outcome: 'SENDING',
    };
    const request = begin();
    if (!request) return;
    setValidation('');
    setSubmissions((items) => [...items, item]);
    setSelectedId(item.id);
    try {
      await send(item, request.signal);
    } finally {
      finish();
    }
  }

  async function retrieve() {
    if (!selected || !client) return;
    const request = begin();
    if (!request) return;
    update(selected.id, { error: undefined });
    try {
      const response = await client.getTransaction(selected.eventId, request.signal);
      if (request.signal.aborted) return;
      update(selected.id, { retrieved: response });
      setNotice(
        selected.saved
          ? 'Retrieved the saved transaction.'
          : 'Saved transaction found. Replay the retained payload to confirm it matches.',
      );
    } catch (error) {
      if (request.signal.aborted) return;
      update(selected.id, { error });
      if (error instanceof ApiError && error.status === 404) {
        setNotice(
          'No saved transaction is visible yet. A 404 does not prove the original request cannot commit. Keep the same ID and payload.',
        );
      }
    } finally {
      finish();
    }
  }

  function select(id: string) {
    if (!working.current) {
      setSelectedId(id);
      setNotice('');
      setValidation('');
    }
  }

  return {
    plan,
    editing,
    setEditing,
    started,
    submissions,
    selected,
    select,
    busy,
    unresolved,
    validation,
    notice,
    choose,
    edit,
    run,
    replay,
    conflict,
    retrieve,
    stop,
  };
}

type Playground = ReturnType<typeof usePlaygroundState>;
const Context = createContext<Playground | null>(null);

export function PlaygroundProvider({ children }: { children: ReactNode }) {
  const playground = usePlaygroundState();
  return <Context value={playground}>{children}</Context>;
}

export function usePlayground() {
  const value = useContext(Context);
  if (!value) throw new Error('PlaygroundProvider is required');
  return value;
}
