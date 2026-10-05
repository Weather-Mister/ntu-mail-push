# Eren Mail — setup and operations

Source of truth: `Weather-Mister/ntu-mail-push`, `sites/eren/`. The existing `mail-demo.js` / `.css` files now contain the real client, retaining the mockup’s shell and styling. Their names are retained for existing asset references. There are no dummy mail records in production.

## Activate your accounts

1. In [Google Cloud](https://console.cloud.google.com/), enable **Gmail API**, configure an OAuth consent screen for your personal app, and create a **Web application** OAuth client.
2. Add this exact authorized redirect URI:

   `https://evckshjtzikuusnkdnjn.supabase.co/functions/v1/eren-mail/oauth/callback`

3. In the Eren PWA, open **Mail → ⚙ → Google & Gemini setup**. Enter the OAuth client ID and client secret. For AI, also enter your Gemini API key and an available Gemini model ID. Press **Save securely**. No source file edits are needed. Blank secret fields keep existing values; stored secret values are never sent back to the browser.
4. Press **Connect Gmail**, grant access, and repeat for each account. Authorize accounts independently. Return to the same browser/PWA that started the connection; the account cannot be attached without that device’s short-lived proof and Eren’s pairing key.
5. If iOS opens Google in Safari separately, finish authorization there, then reopen the original paired PWA to complete the pending connection. If the app is not paired in Safari, do not paste credentials into a URL; return to the original paired PWA.

For unattended daily use, account for Google’s OAuth publishing status. External apps left in **Testing** receive refresh tokens that expire after seven days for Gmail scopes. Configure the appropriate production/personal-use status and follow Google’s applicable verification rules. Tokens can also be revoked or expire for other reasons; Mail displays **Reconnect account** and preserves pending drafts.

Optional operator alternative: set Supabase Edge Function secrets `MAIL_GOOGLE_CLIENT_ID`, `MAIL_GOOGLE_CLIENT_SECRET`, `MAIL_GEMINI_API_KEY`, `MAIL_GEMINI_MODEL`. Environment values take precedence over the secure setup form. These are backend secrets, never GitHub Pages values. Do not put them in Git, chat, public URLs, or client JavaScript.

## Architecture and isolation

- The original `ntu-schedule-api` function is unchanged. Pairing, schedules, COOL, Manual Tasks, PC Transfer and Hanzi remain on their existing paths.
- The separate `eren-mail` function validates a high-entropy pairing key against `schedule_workspaces`, requires `app_slug = eren`, and validates account ownership on every account-scoped operation. Begüm’s key is rejected even though the existing backend shares a database project.
- All `eren_mail_*` tables have RLS enabled with no browser policies; all privileges for `PUBLIC`, `anon`, and `authenticated` are revoked. Only the backend service role accesses them. Vault definer code is in `eren_mail_private`, with fixed search paths and service-only grants; exposed wrappers are invoker functions.
- Google refresh tokens, provider configuration, saved drafts and queued send bodies are encrypted with Supabase Vault. Message bodies are fetched from Gmail on demand. The database stores only metadata, labels, classifications, extracted codes, rules, cursors, and send state as needed.
- OAuth has an expiring single-use state, PKCE and a separate browser proof. Pending grants are attached only after authenticated completion on the initiating device. Expired pending secrets are removed by the worker.
- The existing NTU Mail tile still links to Roundcube. It is not a Gmail account. `check_mail.py`, both notification workflows, POP3 state, push destinations, subscriptions, and `sites/begum/` are untouched.
- Service worker cache `ntu-schedule-github-v8` includes the new mail assets. API responses use `no-store`; the service worker does not cache cross-origin mail responses.

## Background processing and sends

`eren-mail-minute` invokes the mail worker every minute through Supabase Cron and pg_net, authenticated by a token generated and retained in Vault. This runs with the browser/PWA closed. It is separate from the NTU GitHub Actions notification job.

The worker drains due sends first, then processes up to three accounts per run, rotating by last attempt. Each account uses a lease. Large history events are durably split into batches; the history cursor advances only after the whole page is processed. Gmail History cursors synchronize changes; expired cursors recover with a new baseline. Older mail is backfilled in bounded pages while new-mail history continues first. Initial backfill can take time for large mailboxes. The live reader and Gmail search do not wait for backfill.

Sending uses a client request UUID, a server payload digest, atomic queue claims, and a stable RFC Message-ID. Replies use the original Gmail account, thread ID, subject, In-Reply-To and References fetched from Gmail on the server. The client never supplies trusted threading headers.

A due job transitions `pending → processing → sending → sent`. Cancellation is atomic before `sending`. Temporary errors before the external send retry with backoff. A network error after send may have reached Gmail is **uncertain**, never blindly retried. **Outbox → Check Gmail delivery** searches Sent by Message-ID. Search indexing can lag; no result is not proof of non-delivery. Failed or cancelled jobs can restore their body as a new draft; reopen the original thread when a reply must retain its thread.

Scheduled time is entered in the device’s local timezone and stored in UTC. Delivery is due on the next worker cycle, normally within about a minute; provider outages/quotas may delay it. This is server-operated, not a guarantee of delivery at an exact second or a provider uptime SLA. Settings shows the last completed worker run and account sync errors.

## Classification and controls

Account, type, priority, context and action state remain separate fields. Deterministic rules detect common transactional/security/university/list patterns, Gmail category signals and login codes. Unknown mail stays **Other / Needs classification**. No AI is required for mailbox operations.

Explicit rules override inference, ordered from domain → sender → mailing list → thread → message, with type-specific rules following broader rules at the same scope. A user can set any supported type/priority/action and free-text context in the reader. Latest outbound replies change inferred Needs reply to Waiting; explicit action corrections still win.

Mute changes local priority to Muted. Block is local and never maps to Gmail Spam or deletion. Both are reversible in Settings. Scope can be a sender, domain, thread, or a declared List-ID, optionally limited to a mail type. Promotion rules can leave receipts alone.

Unsubscribe controls appear only for supported headers. Confirmed one-click POST uses a DNS-validated, pinned public IP and hostname-verified TLS, without redirects, cookies or OAuth credentials. Safe HTTPS unsubscribe pages open explicitly. A mailto option opens a reviewable composer; it is not sent automatically. A successful POST is recorded as a request, not a promise that a sender will stop instantly.

HTML is sanitized server-side with a strict allowlist and displayed in a sandboxed iframe with restrictive CSP. Safe text styling, table layouts and responsive CSS are preserved. Raster embedded (CID) images display automatically, subject to size limits. External HTTPS images load by default, as requested. All email content remains sandboxed; scripts and active content cannot run. External images can reveal opens to senders. Scripts, forms, embedded active content, CSS URLs/imports and remote fonts remain blocked. Plain text remains available. Attachment metadata and downloads are supported (20 MB download limit); attaching files to outbound mail is not included in this release.

## Composer and drafts

The AI instruction is above the editable body. Every Gemini call receives the current recipient/subject/body and at most six messages from the selected reply thread, bounded per message. The model comes from server configuration. The system prompt prohibits invented factual details and treats incoming mail as untrusted context. Gemini cannot send mail or apply rules.

Undo AI and Redo preserve body revisions. Provider errors preserve the draft. If a user edits while a generation runs, the late result is discarded instead of overwriting those edits. No hidden AI draft is used.

Drafts are retained on the current tab and autosaved, serialized, to encrypted server storage. Offline edits remain on the tab; **Save draft** confirms server persistence. The Drafts view holds this client’s drafts separately from Gmail’s native draft folder. New emails support multiple To addresses separated by commas; outbound attachments, Cc/Bcc, native Gmail-draft editing and rich-text composition are not implemented.

## Deployment and checks

The backend and four migrations have been deployed through the connected Supabase management API. The minute cron worker has been observed completing successfully with no connected accounts. The GitHub Pages deployment copies only `sites/eren/` and `sites/begum/`; backend sources and development dependencies cannot enter the public artifact.

Validation commands:

```sh
npm ci
npm test
npm run check:mail
npm run test:server
npx playwright install --with-deps chromium
npm run test:ui
```

Backend redeployment targets only `eren-mail`, with its `deno.json` and relative files. Never redeploy or replace `ntu-schedule-api` as part of Mail. Do not replay the entire migration directory against another shared project without reviewing the existing schema.

The tests exercise classification, codes, MIME/threading, RLS/secret boundaries, OAuth proof binding, selected-account sending, duplicate-send handling, cancellation, uncertain-send reconciliation, background history during backfill, HTML safety, AI failure/edit races, desktop/mobile readers, account filters, and existing dashboard widgets with isolated provider fixtures. Database RLS/privileges, Vault roundtrip, atomic claims, rate limiting, unauthenticated API denial and cron heartbeat were checked against the actual backend.

**Release acceptance still requires live Google authorization and a controlled test on your own account:** connect two accounts; read/search/filter; archive and restore; send a test to yourself; reply and verify the same Gmail thread; schedule a test with the PWA closed; cancel another scheduled test; try Gemini and a supported mailing-list unsubscribe. No live user email was sent or unsubscribed during implementation. Automated fixtures do not substitute for these live checks. Keep Gmail available until they pass.

## Later automation

The explicit command routes and typed, persistent rules provide a foundation for future natural-language commands. An AI action planner should return a preview containing exact account/message IDs, scopes, recipients and proposed changes, then require approval before calling existing mutation routes. No automatic sending, bulk AI execution, task creation, or natural-language action agent is enabled in this release.

## References

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Google personal-use verification exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Gmail threads](https://developers.google.com/workspace/gmail/api/guides/threads)
- [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase Vault](https://supabase.com/docs/guides/database/vault)
- [RFC 8058 one-click unsubscribe](https://www.rfc-editor.org/rfc/rfc8058)

Mailbox performance: the first view uses background-synced metadata while canonical Gmail data refreshes. Inbox pages and up to six readers stay in tab memory briefly; no email bodies are added to browser persistent storage. The next three readers are prefetched. The server reuses unexpired access tokens in bounded process memory, batches reconstructible metadata writes, and skips HTML rendering for list rows. Refresh bypasses tab caches. Gmail ownership checks still run for every API request.
