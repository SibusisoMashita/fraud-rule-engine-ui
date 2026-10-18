import { useState, type FormEvent } from 'react';
import { useRetrySeconds, useSession } from './session';
import { Failure } from '../shared/Feedback';
import { Icon } from '../shared/Icon';

export function Connection() {
  const session = useSession();
  const [key, setKey] = useState('');
  const seconds = useRetrySeconds(session.retryAt);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = key.trim();
    setKey('');
    await session.connect(candidate);
  }

  if (session.client) return null;
  return (
    <section className="connection-card" aria-labelledby="connection-heading">
      <div className="connection-intro">
        <span className="connection-symbol">
          <Icon name="lock" />
        </span>
        <div>
          <h2 id="connection-heading">Connect to your engine</h2>
          <p>Use your local API key to try transactions and inspect saved decisions.</p>
        </div>
      </div>
      <form onSubmit={submit} className="connection-form">
        <label htmlFor="api-key">API key</label>
        <div className="input-action">
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            maxLength={256}
            required
            placeholder="Paste your local API key"
            disabled={session.connecting}
          />
          <button
            className="button primary"
            disabled={session.connecting || seconds > 0 || !key.trim()}
          >
            {session.connecting ? 'Connecting…' : seconds ? `Wait ${seconds}s` : 'Connect'}
            <Icon name="arrow" />
          </button>
        </div>
      </form>
      <p className="connection-note">
        <Icon name="shield" />
        Your key stays in memory. Reloading or disconnecting clears it.
      </p>
      {session.error != null && <Failure error={session.error} />}
    </section>
  );
}

export function AdministratorConnection() {
  const session = useSession();
  const [key, setKey] = useState('');
  const seconds = useRetrySeconds(session.adminRetryAt);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = key.trim();
    setKey('');
    await session.connectAdmin(candidate);
  }
  return (
    <details className="admin-connection">
      <summary>
        <Icon name="lock" />
        Administrator access <span className="muted">Optional</span>
      </summary>
      <div className="admin-body">
        <p>
          A separate administrator key can read the complete document, revision and ETag when the
          backend administration overlay is enabled. This foundation is read-only.
        </p>
        {session.adminClient ? (
          <div className="inline-between">
            <span className="status status-clear">Administrator connected</span>
            <button className="button secondary" onClick={session.disconnectAdmin}>
              Disconnect administrator
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="admin-key">Administrator API key</label>
            <div className="input-action">
              <input
                id="admin-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={256}
                required
                value={key}
                onChange={(event) => setKey(event.target.value)}
                disabled={session.adminConnecting}
              />
              <button
                className="button secondary"
                disabled={session.adminConnecting || seconds > 0 || !key.trim()}
              >
                {session.adminConnecting
                  ? 'Connecting…'
                  : seconds
                    ? `Wait ${seconds}s`
                    : 'Connect administrator'}
              </button>
            </div>
          </form>
        )}
        {session.adminError != null && <Failure error={session.adminError} />}
      </div>
    </details>
  );
}
