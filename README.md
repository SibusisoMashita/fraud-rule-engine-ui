# Fraud Rule Engine UI

**Fraud Rule Engine — Assessment Demo** is a React and TypeScript interface for the [Fraud Rule Engine Service](https://github.com/SibusisoMashita/fraud-rule-engine-service). It uses the supplied Capitec assets for this assessment presentation.

Submit synthetic transactions, explore five editable scenarios, browse saved evaluations and inspect active policy. Administrators can validate, review and activate policy changes. Every displayed decision comes from the API.

## Run with Docker

You need Git and Docker with Compose 2.24.4+. On Windows, use Docker Desktop with WSL2 and run these commands in Ubuntu; the backend's [WSL2 setup](https://github.com/SibusisoMashita/fraud-rule-engine-service/blob/main/docs/OPERATIONS.md#windows-with-wsl2) covers the shared prerequisites. macOS and Linux use the same commands in a POSIX terminal.

1. Start the backend using its [quickstart](https://github.com/SibusisoMashita/fraud-rule-engine-service#quickstart). Keep this UI and `fraud-rule-engine-service` in sibling folders for the verification script.
2. From this UI folder, run:

   ```sh
   docker compose up -d --build --wait
   ```

3. Open [localhost:3000](http://localhost:3000). Paste the backend's `secrets/local-api-key` into the connection form.

The key stays in memory until you disconnect or reload. The browser sends requests to the UI's own origin; NGINX forwards API calls to the backend's Docker network. PostgreSQL and Redis need no published ports.

For policy editing, follow the backend's optional [administrator setup](https://github.com/SibusisoMashita/fraud-rule-engine-service/blob/main/docs/OPERATIONS.md#optional-policy-administration-api). Connect with your ordinary key first, then open **Policy → Administrator access** and use the separate `secrets/local-policy-admin-api-key`. Administration stays disabled in the ordinary backend quickstart.

Stop the UI with `docker compose down`. This leaves the backend running.

## Try transactions

Open **Try transactions** and choose a manual transaction or one of the five scenarios. Review and edit the steps, then submit. Scenarios send in order and stop at the first failed or uncertain response. Preset values are examples; the backend's live policy determines the result. **New scenario run** creates fresh identifiers.

Select a submission to inspect its rule evidence and raw response, replay the retained payload or send a different amount under the same event ID. For an uncertain response, keep that ID and payload and use the explicit recovery actions; [recovery details](docs/ARCHITECTURE.md#submission-and-recovery) explain what retrieval can confirm.

The submission journal stays in memory when you change screens. Disconnecting or reloading clears it, so resolve uncertain submissions before leaving the session.

## Edit policy

1. Connect an administrator and read the current policy. The editor starts from the API's complete document, revision and hash.
2. Change the rule, currency or event-timing fields, or use **Policy JSON**. Both views share one draft; monetary settings remain quoted decimal strings.
3. Choose **Validate draft**, then **Review changes**. Any further edit requires validation again.
4. Review the differences and choose **Activate policy**. Changes apply across the engine to new evaluations without a restart. Saved results and replays keep their original policy.

If another administrator changes the policy, activation stops. **Read current policy** keeps your draft so you can compare it with the new base, validate and review again. If an activation response is lost, read the current policy before deciding what to do; activation never retries automatically. [Recovery details](docs/ARCHITECTURE.md#policy-editing) explain what the comparison can confirm.

Drafts stay in memory across navigation. Disconnecting the administrator, disconnecting the engine or reloading clears them. The backend remains responsible for permissions, validation and revision guards.

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

[CI](.github/workflows/verify.yaml) runs these checks on Linux, installs browser dependencies and scans the runtime image and source. Generated test results are excluded from Git. Browser traces and videos stay disabled. Screenshots are off by default; optional local previews require empty credential fields and stay under ignored `target/preview/`. A Windows host still needs WSL2; native Windows execution is outside these POSIX instructions.

## Where to look

- [Architecture](docs/ARCHITECTURE.md): feature folders, credentials, precision and proxy boundaries.
- [Pinned API contract](api/openapi.yaml): the requests and responses used by the client.
- [Backend rules](https://github.com/SibusisoMashita/fraud-rule-engine-service/blob/main/docs/RULES.md): rule behaviour and policy settings.

This is a local assessment demo. Hosted deployment is a separate step.
