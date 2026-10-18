import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, type ApiClient, type ApiResponse, type EditablePolicy } from '../../api/client';
import { useSession } from '../../app/session';
import { parseDraft, policyJson } from './model';

type Snapshot = ApiResponse<EditablePolicy>;
interface Candidate {
  raw: string;
  hash: string;
  base: Snapshot;
}
interface EditorState {
  owner: ApiClient | null;
  snapshot: Snapshot | null;
  raw: string;
  candidate: Candidate | null;
  reviewed: boolean;
  phase: 'idle' | 'reading' | 'validating' | 'activating';
  stale: boolean;
  uncertain: { candidate: Candidate; checked: boolean } | null;
  notice: string;
  recoveryNotice: string;
  error: unknown;
}
function initial(owner: ApiClient | null): EditorState {
  return {
    owner,
    snapshot: null,
    raw: '',
    candidate: null,
    reviewed: false,
    phase: 'idle',
    stale: false,
    uncertain: null,
    notice: '',
    recoveryNotice: '',
    error: null,
  };
}
interface EditorContext extends EditorState {
  edit(raw: string): void;
  readCurrent(): void;
  validate(): void;
  review(): void;
  activate(): void;
  cancelPending(): void;
}
const Context = createContext<EditorContext | null>(null);

function etagAvailable(snapshot: Snapshot | null): snapshot is Snapshot & { etag: string } {
  return !!snapshot?.etag && /^"policy-revision-[1-9][0-9]*"$/.test(snapshot.etag);
}

export function PolicyEditorProvider({ children }: { children: ReactNode }) {
  const { adminClient } = useSession();
  const [state, setState] = useState<EditorState>(() => initial(adminClient));
  const current = useRef(state);
  const owner = useRef(adminClient);
  owner.current = adminClient;
  const request = useRef<{ id: number; controller: AbortController } | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);

  const update = useCallback((next: EditorState) => {
    current.current = next;
    setState(next);
  }, []);
  const begin = useCallback(
    (phase: EditorState['phase']) => {
      const previous = current.current;
      if (!owner.current || previous.owner !== owner.current || previous.phase !== 'idle')
        return null;
      const operation = {
        id: ++sequence.current,
        controller: new AbortController(),
        client: owner.current,
      };
      request.current = operation;
      update({ ...previous, phase, error: null, notice: '' });
      return operation;
    },
    [update],
  );
  function active(operation: { id: number; client: ApiClient }) {
    return (
      mounted.current && owner.current === operation.client && request.current?.id === operation.id
    );
  }
  const readCurrent = useCallback(() => {
    const operation = begin('reading');
    if (!operation) return;
    void operation.client
      .getEditablePolicy(operation.controller.signal)
      .then((snapshot) => {
        if (!active(operation)) return;
        const previous = current.current;
        const uncertain = previous.uncertain;
        let recoveryNotice = previous.recoveryNotice;
        if (uncertain) {
          recoveryNotice =
            snapshot.data.policyHash === uncertain.candidate.hash
              ? 'Current policy matches the attempted candidate. This confirms the current state, not which request activated it.'
              : snapshot.etag === uncertain.candidate.base.etag
                ? 'The earlier revision is still current. The uncertain request may still finish; this read does not prove it failed. You may start a new validation and review using this revision.'
                : 'Current policy differs from the attempted candidate. It may have changed after an earlier activation. Review your draft against this revision before any new activation.';
        }
        update({
          ...previous,
          snapshot,
          raw: previous.snapshot === null ? policyJson(snapshot.data.document) : previous.raw,
          candidate: null,
          reviewed: false,
          phase: 'idle',
          stale: false,
          uncertain: uncertain ? { ...uncertain, checked: true } : null,
          recoveryNotice,
          error: null,
        });
        request.current = null;
      })
      .catch((error: unknown) => {
        if (!active(operation)) return;
        update({ ...current.current, phase: 'idle', error });
        request.current = null;
      });
  }, [begin, update]);

  useEffect(() => {
    mounted.current = true;
    request.current?.controller.abort();
    request.current = null;
    update(initial(adminClient));
    if (adminClient) readCurrent();
    return () => {
      request.current?.controller.abort();
      request.current = null;
    };
  }, [adminClient, readCurrent, update]);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  function edit(raw: string) {
    const previous = current.current;
    if (
      previous.owner !== owner.current ||
      previous.phase !== 'idle' ||
      (previous.uncertain && !previous.uncertain.checked)
    )
      return;
    update({ ...previous, raw, candidate: null, reviewed: false, notice: '', error: null });
  }
  function validate() {
    const previous = current.current;
    if (!previous.snapshot || previous.stale || (previous.uncertain && !previous.uncertain.checked))
      return;
    try {
      parseDraft(previous.raw, true);
    } catch (error) {
      update({ ...previous, candidate: null, reviewed: false, error });
      return;
    }
    const operation = begin('validating');
    if (!operation) return;
    const raw = previous.raw;
    const base = previous.snapshot;
    update({ ...current.current, candidate: null, reviewed: false });
    void operation.client
      .validatePolicy(raw, operation.controller.signal)
      .then((response) => {
        if (!active(operation)) return;
        update({
          ...current.current,
          phase: 'idle',
          candidate: { raw, hash: response.data.policyHash, base },
          reviewed: false,
          error: null,
        });
        request.current = null;
      })
      .catch((error: unknown) => {
        if (!active(operation)) return;
        update({ ...current.current, phase: 'idle', candidate: null, reviewed: false, error });
        request.current = null;
      });
  }
  function review() {
    const previous = current.current;
    if (
      previous.owner === owner.current &&
      previous.phase === 'idle' &&
      previous.candidate &&
      !previous.stale
    )
      update({ ...previous, reviewed: true });
  }
  function activate() {
    const previous = current.current;
    const candidate = previous.candidate;
    if (
      !candidate ||
      !previous.reviewed ||
      previous.stale ||
      (previous.uncertain && !previous.uncertain.checked)
    )
      return;
    if (!etagAvailable(candidate.base)) {
      update({
        ...previous,
        error: new Error('Read current policy to obtain a revision ETag before activation.'),
      });
      return;
    }
    const operation = begin('activating');
    if (!operation) return;
    void operation.client
      .activatePolicy(candidate.raw, candidate.base.etag, operation.controller.signal)
      .then((snapshot) => {
        if (!active(operation)) return;
        update({
          ...current.current,
          snapshot,
          raw: policyJson(snapshot.data.document),
          candidate: null,
          reviewed: false,
          phase: 'idle',
          stale: false,
          uncertain: null,
          recoveryNotice: '',
          notice:
            snapshot.etag === candidate.base.etag
              ? 'Policy unchanged; revision preserved.'
              : 'Policy activated.',
          error: null,
        });
        request.current = null;
      })
      .catch((error: unknown) => {
        if (!active(operation)) return;
        const stale = error instanceof ApiError && error.status === 412;
        const unknown = !(error instanceof ApiError) || error.outcome === 'UNKNOWN';
        update({
          ...current.current,
          phase: 'idle',
          candidate: null,
          reviewed: false,
          stale,
          uncertain: unknown ? { candidate, checked: false } : current.current.uncertain,
          recoveryNotice: '',
          error,
        });
        request.current = null;
      });
  }
  function cancelPending() {
    const previous = current.current;
    if (previous.owner !== owner.current || previous.phase === 'idle') return;
    request.current?.controller.abort();
    request.current = null;
    update({
      ...previous,
      phase: 'idle',
      candidate: null,
      reviewed: false,
      uncertain:
        previous.phase === 'activating' && previous.candidate
          ? { candidate: previous.candidate, checked: false }
          : previous.uncertain,
    });
  }
  const visible = state.owner === adminClient ? state : initial(adminClient);
  return (
    <Context.Provider
      value={{ ...visible, edit, readCurrent, validate, review, activate, cancelPending }}
    >
      {children}
    </Context.Provider>
  );
}

export function usePolicyEditor() {
  const editor = useContext(Context);
  if (!editor) throw new Error('Policy editor provider is missing.');
  return editor;
}
