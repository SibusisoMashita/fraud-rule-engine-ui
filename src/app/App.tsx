import { useEffect, useRef, useState } from 'react';
import { Connection } from './Connection';
import { SessionProvider, useSession } from './session';
import { Evaluations } from '../features/evaluations/Evaluations';
import { Policy } from '../features/policy/Policy';
import { Transactions } from '../features/transactions/Transactions';
import { Icon } from '../shared/Icon';
import { PlaygroundProvider } from '../features/transactions/playground';
import { PolicyEditorProvider } from '../features/policy/editor';

type Screen = 'evaluations' | 'policy' | 'transactions';
const screens: Array<{
  id: Screen;
  label: string;
  icon: 'evaluations' | 'policy' | 'transactions';
}> = [
  { id: 'transactions', label: 'Try transactions', icon: 'transactions' },
  { id: 'evaluations', label: 'Evaluations', icon: 'evaluations' },
  { id: 'policy', label: 'Policy', icon: 'policy' },
];
function currentScreen(): Screen {
  const route = window.location.hash.slice(1);
  return route === 'policy' || route === 'transactions' ? route : 'evaluations';
}

function Shell() {
  const [screen, setScreen] = useState(currentScreen);
  const { client, disconnect, generation } = useSession();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const changed = () => {
      setScreen(currentScreen());
      main.current?.focus();
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="#evaluations" aria-label="Capitec assessment demo home">
          <img src="/capitec-logo.svg" alt="Capitec" width="166" height="24" />
        </a>
        <div className="sidebar-section">
          <p className="eyebrow">Fraud workspace</p>
          <nav aria-label="Main navigation">
            {screens.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={screen === item.id ? 'page' : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <Icon name="shield" />
          <strong>Built for understanding.</strong>
          <p>
            Real decisions.
            <br />
            Traceable evidence.
          </p>
          <span>Local assessment demonstration</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <h1>
            Fraud Rule Engine <span>— Assessment Demo</span>
          </h1>
          <div className="connection-status">
            <span className={`connection-dot ${client ? 'connected' : ''}`} />
            <span>{client ? 'Connected' : 'Disconnected'}</span>
            {client && (
              <button className="text-button" onClick={disconnect}>
                Disconnect
              </button>
            )}
          </div>
        </header>
        <main id="main-content" ref={main} tabIndex={-1}>
          <Connection />
          <div key={generation}>
            <PlaygroundProvider>
              <PolicyEditorProvider>
                {screen === 'policy' ? (
                  <Policy />
                ) : screen === 'transactions' ? (
                  <Transactions />
                ) : (
                  <Evaluations />
                )}
              </PolicyEditorProvider>
            </PlaygroundProvider>
          </div>
        </main>
        <footer className="footer">
          <span>Fraud Rule Engine · Assessment Demo</span>
          <span>Local demonstration using synthetic transaction data.</span>
        </footer>
      </div>
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
