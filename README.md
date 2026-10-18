# Fraud Rule Engine UI

**Fraud Rule Engine — Assessment Demo** is a React and TypeScript interface for the [Fraud Rule Engine Service](https://github.com/SibusisoMashita/fraud-rule-engine-service). It uses the supplied Capitec assets for this assessment presentation.

This foundation lets you browse saved evaluations, open transaction evidence and inspect active policy. Transaction scenarios and the policy editor follow in the next check-ins. Every displayed evaluation comes from the API.

## Run with Docker

You need Git and Docker with Compose 2.24.4+. On Windows, use Docker Desktop with WSL2 and run these commands in Ubuntu; the backend's [WSL2 setup](https://github.com/SibusisoMashita/fraud-rule-engine-service/blob/main/docs/OPERATIONS.md#windows-with-wsl2) covers the shared prerequisites. macOS and Linux use the same commands in a POSIX terminal.

1. Start the backend using its [quickstart](https://github.com/SibusisoMashita/fraud-rule-engine-service#quickstart). Keep this UI and `fraud-rule-engine-service` in sibling folders for the verification script.
2. From this UI folder, run:

   ```sh
   docker compose up -d --build --wait
   ```

3. Open [localhost:3000](http://localhost:3000). Paste the backend's `secrets/local-api-key` into the connection form.

The key stays in memory until you disconnect or reload. The browser sends requests to the UI's own origin; NGINX forwards API calls to the backend's Docker network. PostgreSQL and Redis need no published ports.

For the optional administrator connection, follow the backend's [administrator setup](https://github.com/SibusisoMashita/fraud-rule-engine-service/blob/main/docs/OPERATIONS.md#optional-policy-administration-api) and use its separate `secrets/local-policy-admin-api-key`. This check-in uses it to inspect the editable document and revision.

Stop the UI with `docker compose down`. This leaves the backend running.

## Change the Docker connection

Defaults work with the backend's ordinary Compose quickstart. Copy [.env.example](.env.example) to `.env` only when you need different infrastructure settings; API keys belong in the connection form.

| Setting           | Default                             | When to change it                                               |
| ----------------- | ----------------------------------- | --------------------------------------------------------------- |
| `UI_PORT`         | `3000`                              | Another application already uses this port                      |
| `BACKEND_NETWORK` | `fraud-rule-engine-service_default` | Your backend uses a different Compose project name              |
| `API_UPSTREAM`    | `app:8080`                          | Use `load-balancer:8080` with the backend's balanced deployment |

After changing `.env`, run `docker compose up -d --wait --force-recreate ui`. The proxy follows Docker DNS changes when the backend is recreated. An unavailable backend produces an API error while the UI remains accessible; `/health/live` checks the UI container only.

Load balancing and autoscaling stay in the backend's [scaling scripts](https://github.com/SibusisoMashita/fraud-rule-engine-service/blob/main/docs/SCALING.md). Start that deployment before choosing `load-balancer:8080`.

## Develop and test

Install Node.js 24.22.0 or newer; [.nvmrc](.nvmrc) and the Docker build pin the supported LTS release. Then run:

```sh
npm ci
npm run dev
```

The Vite development server proxies API requests to `http://localhost:8080`. Docker provides the full same-origin setup described above.

```sh
npm run check
npm audit --audit-level=high
npx playwright install chromium
npm run verify:docker
```

Docker verification needs the sibling backend checkout at the revision in [api/source.json](api/source.json). Set `BACKEND_PROJECT_DIR` if it lives elsewhere. The script builds isolated projects, runs browser and API checks, and removes its containers and test data afterward. It does not use your running demo database.

[CI](.github/workflows/verify.yaml) runs these checks on Linux, installs browser dependencies and scans the runtime image and source. Generated test results are excluded from Git. Browser traces, videos and screenshots stay disabled so they cannot capture API keys. A Windows host still needs WSL2; native Windows execution is outside these POSIX instructions.

## Where to look

- [Architecture](docs/ARCHITECTURE.md): feature folders, credentials, precision and proxy boundaries.
- [Pinned API contract](api/openapi.yaml): the requests and responses used by the client.
- [Backend rules](https://github.com/SibusisoMashita/fraud-rule-engine-service/blob/main/docs/RULES.md): rule behaviour and policy settings.

This is a local assessment demo. Hosted deployment is a separate step.
