# Begüm schedule migration

Reuse Eren’s schedule Worker, D1, authenticated task-sync Durable Object and private SQLite file storage. Target account: `fb77361332c979fc8a3e0d25a03d8f69`. Mail, notification routes, push subscriptions, service workers and their secrets are excluded.

This preparation does not change any live site. Begüm’s source had six tasks and no transfer items at the first inspection. Refresh the source snapshot immediately before deployment. Its private COOL feed belongs only in the ignored `.private/snapshot.json` and a Worker secret.

Deploy `begum-schedule-api` with `begum-schedule-db` using `scripts/deploy-begum.mjs --deploy`, with a dedicated account connection in `BEGUM_CLOUDFLARE_API_TOKEN` or ignored `.private/cloudflare-token.txt`. The default invocation only describes the plan. The account must have a Workers subdomain initialized. It refuses to overwrite existing resources and verifies D1/API task fields, COOL feed parity and two authenticated task sockets. No source rows are modified. A partial deployment must be inspected using `evidence/resources.json`, never blindly retried.

Bundle `src/worker.mjs` to `artifacts/worker.mjs` with the pinned esbuild version before deploying. After live checks pass, run `node scripts/build-begum.mjs <verified-worker-url>`. This produces a website entry point, non-mail fetch adapter, task-sync script, and one `NTU-Begum-Tasks.jsx` widget. The source widget is reference input and still points to the legacy service. Install only the generated widget after cutover; its layout and local cache key are preserved.

Before publishing, verify the current source still matches the destination, briefly stop schedule edits, then block stale **Begüm-only** task/transfer writes. Preserve original rows, notification writes and Eren’s existing safeguards. Publish only the three generated Begüm frontend files. Do not change either mail system. Reload already paired devices online, and replace the Mac widget. There is no fallback that writes into both databases.

Validation to date: 12 unit/contract checks pass, including task ownership, import preservation, calendar parsing, route isolation and widget pairing/reload/rejection behavior. The Worker and JSX compile. Native Cloudflare-runtime tests require child process support and have not run successfully in this session. Remote checks and actual Mac/PWA installation remain pending account connection and deployment.
