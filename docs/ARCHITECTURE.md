# Architecture

The UI explains the existing service through three feature areas. Business decisions and permission checks remain in the backend.

| Area                        | Responsibility                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `src/features/transactions` | Editable transactions, five sample histories, retained payloads, replay and recovery |
| `src/features/evaluations`  | Filters, cursor pages and full transaction evidence                                  |
| `src/features/policy`       | Active rule settings and optional administrator inspection; editing follows later    |
| `src/api`                   | One HTTP client, generated contract types and lossless JSON handling                 |
| Shared UI and theme         | Connection state, reusable controls, navigation and visual tokens                    |

## Requests and credentials

The browser calls only relative `/api/v1` paths. One client adds the appropriate in-memory API key and handles API errors, correlation IDs and `Retry-After`. It does not automatically retry requests. Disconnecting or reloading clears credentials and displayed protected data. Keys are excluded from storage, URLs and application logs.

The ordinary credential needs `INGEST` to submit transactions, `READ` to retrieve scoped results and `POLICY` to inspect rules. A separate optional `POLICY_ADMIN` credential can read the complete policy document and revision. The UI does not grant permissions; the backend checks each request. Administrator connection errors do not promote the ordinary key.

Generated API types come from the committed [OpenAPI copy](../api/openapi.yaml). [Source metadata](../api/source.json) records its backend revision and checksum. `npm run api:check` verifies the checksum and generated types; update the contract deliberately with the backend change.

Money remains a string. JSON evidence numbers use lossless parsing and retain their original decimal representation when displayed or formatted as JSON. Policy revisions also avoid floating-point conversion. These boundaries matter because evidence must match the stored result exactly.

## Submission and recovery

The playground serializes each edited draft before dispatch and retains that exact payload. An identical replay uses the retained text, including its original timestamp and event ID. A conflicting duplicate changes only the amount, using exact decimal comparison to reject equivalent values such as `100.00` and `100.0`.

Each scenario sends one transaction at a time and stops on failure or an unknown outcome. A timeout, cancellation or unreadable write response may follow a commit. The UI keeps this uncertainty visible and leaves retrieval and replay to the user.

A successful GET confirms that a transaction is visible under the event ID; it does not establish that an uncertain submitted payload matches. Replay the retained payload to confirm identity. A 404 also does not prove non-commit: the original write may still be in progress. Do not replace the event ID to work around uncertainty.

The provider keeps drafts, submission results and original payloads in memory across screen navigation. Leaving the transaction screen stops an active run; its journal remains available for recovery. Reloading, disconnecting or receiving a 401 for the ordinary credential clears the session and journal. Starting a new scenario creates new identifiers without changing saved backend results.

## Docker boundary

```text
Browser on localhost:3000
    |
    +-- static files --> unprivileged NGINX
    |
    +-- /api/v1/... --> NGINX --> app:8080 or load-balancer:8080
                                      |
                                existing backend
```

The UI joins an existing external Docker network. Startup accepts only the two documented upstream names. NGINX proxies the API's known paths, preserves backend responses and disables upstream retries. NGINX refreshes addresses through Docker DNS with a five-second cache; requests can fail during a backend handoff. The UI stays available, and the user can retry a read after recovery. The UI cannot start or scale backend containers.

The image builds with pinned Node and NGINX digests. NGINX runs as a non-root user with a read-only filesystem, dropped capabilities and a small temporary filesystem. Only the loopback UI port is published. `/health/live` reports that NGINX serves requests, independently of backend readiness.

Assets and Inter fonts are bundled with the build. Shared CSS holds the supplied branding's colours, spacing and controls. The Content Security Policy permits local scripts, styles, images and fonts, with same-origin connections. No external asset service or browser storage is required.

## Verification

Vitest and React Testing Library cover client behaviour, exact request serialization, scenario sequencing and screen states. Playwright runs against real disposable Docker services for transaction scenarios, connection, permissions, persisted data, pagination and policy inspection. The Docker verifier replaces the backend at a different IP while keeping the UI container running. It requires sustained successful reads across DNS refreshes before checking browser reconnection and subsequent reads. Helper tests cover interrupted recovery and bounded timeouts. CI uses the exact backend revision from the contract metadata.

The policy edit/validate/review/activate flow remains the next planned check-in. Backend rule algorithms, activation transactions and operational limits are described in the [service architecture](https://github.com/SibusisoMashita/fraud-rule-engine-service/blob/main/docs/ARCHITECTURE.md).
