# Begüm Cloudflare Mail

Begüm’s Garden uses `https://begum-mail-api.begum-schedule-fb773613.workers.dev/eren-mail` in her Cloudflare account `fb77361332c979fc8a3e0d25a03d8f69`. This reuses Eren’s existing mail provider implementation, SQLite Durable Object storage, encrypted server credentials, bounded background sync and attachment storage. No R2 or billing setup is required.

The original NTU mailbox ID, 1,656 cached messages, saved draft, preferences, Google configuration, Gemini configuration and private mail key were imported with row and encryption parity. Public schedule words cannot access mail. Account ownership and browser storage remain separate from Eren. The private key hash is separate from the schedule workspace hash.

Google uses the direct Cloudflare callback `https://begum-mail-api.begum-schedule-fb773613.workers.dev/eren-mail/oauth/callback`. Add this exact URI to the existing Google Web OAuth client’s authorized redirect URIs before connecting a new Gmail account. The Worker validates its own expiring state, PKCE and browser proof before saving an account. Gmail accounts require their owner’s Google authorization. The callback does not depend on the quota-blocked Supabase runtime.

Legacy Begüm mail requests return `410` so an old tab cannot keep writing into the old database. The legacy outbox claim preserves Eren’s existing exclusion and adds Begüm. Source data is retained. The shared legacy cron excludes Begüm’s mailbox from sync; notification code, subscriptions and notification jobs are unchanged. Do not remove these safeguards or reimport a live destination without reconciling newer writes.

For maintenance, install the pinned dependencies with `pnpm install --frozen-lockfile`, then deploy `config/begum.json` with Wrangler while signed in to Begüm’s account. Preserve the installed `MAIL_KEY_HASH`, `MAIL_WORKSPACE_HASH`, `MAIL_ENCRYPTION_KEY` and maintenance key hash. Never regenerate encryption or pairing keys during a redeploy. Never put credentials, transfer payloads or mailbox content in source control or Pages assets.

Validation includes SQLite ownership/encryption/claim contracts, NTU read recovery, real inbox/thread/pagination/draft reads, a direct Cloudflare callback and a provider-mocked Gmail flow including browser proof and callback replay rejection. Setup sends no test emails and makes no provider mailbox mutations. Physical device/PWA refresh and owner-authorized Gmail connection are separate from these checks.
