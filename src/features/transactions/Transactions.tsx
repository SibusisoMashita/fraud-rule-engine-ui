import { ruleLabels } from '../../shared/ruleLabels';
import { Icon } from '../../shared/Icon';

export function Transactions() {
  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Next milestone</p>
          <h2>Try transactions</h2>
          <p>A transaction playground for all five rules is coming next.</p>
        </div>
        <span className="read-only-label">Planned</span>
      </header>
      <section className="playground-preview">
        <span className="empty-icon">
          <Icon name="transactions" />
        </span>
        <h3>Test a scenario. Follow the result.</h3>
        <p>
          The next check-in adds editable synthetic scenarios, sequential history, identical replay
          and recovery. Results will always come from the real engine.
        </p>
        <div className="scenario-preview">
          {Object.values(ruleLabels).map((rule) => (
            <div key={rule.number}>
              <span>{rule.number}</span>
              <strong>{rule.name}</strong>
            </div>
          ))}
        </div>
        <p className="muted">
          For now, submit transactions through the backend’s Postman collection or Swagger, then
          inspect the saved decisions in Evaluations.
        </p>
        <a href="#evaluations" className="button primary">
          Browse evaluations
          <Icon name="arrow" />
        </a>
      </section>
    </>
  );
}
