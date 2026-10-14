Mail migration completed 14 October 2026. Reload the Garden online once to load its Cloudflare mail routing. Her existing private Mail key still works. Gmail uses the direct Cloudflare callback listed below and requires Google authorization. Notification jobs and subscriptions are unchanged.

# Begüm's Garden Mail
Open https://weather-mister.github.io/ntu-mail-push/begum/?open=mail and enter the private Mail access key once per device. The public schedule word cannot access Mail.

The Mail button lives beside Today and Refresh. Gmail and NTU accounts, drafts, send queues, rules, provider settings, browser proofs, and preferences belong to Begüm's workspace. Eren's accounts are not copied or shared. The base mail client and styles are identical files, checked for parity; `data-workspace="begum"` selects Begüm's browser storage namespace. Garden overrides provide green, cream, pink, and honey colors. Chinese translation is available on desktop and mobile.

Google returns authorization to the workspace that started it. Add `https://begum-mail-api.begum-schedule-fb773613.workers.dev/eren-mail/oauth/callback` to the existing Google OAuth app’s authorized redirect URIs. The existing client ID and secret remain configured. Connect each Gmail through Mail → Settings → Connect Gmail. Google must authorize each new mailbox. If Google reports access denied because the app is in Testing, add that account as a test user in the existing Google Cloud OAuth audience settings.

NTU Mail connects through the same verified Roundcube provider as Eren. Mail → Settings → Connect NTU Mail accepts the student ID and mailbox password. Credentials stay in encrypted server storage. Her existing GitHub notification credentials have been imported by the narrowly pinned, expiring OIDC runner. Import approval was consumed and the temporary workflow removed after a successful live inbox check.

Begüm now uses her own Cloudflare mail Worker and encrypted SQLite Durable Objects, reusing Eren’s provider implementation. Her existing private Mail key, mailbox, draft and settings are preserved; the key is never included in public assets or URLs. The background mail worker runs separately in her Cloudflare account. All account operations validate workspace ownership. Schedule, COOL, tasks, pairing and notification enrollment keep their existing paths. Notification clicks open Begüm's PWA.

Validation: `npm test`, `npm run check:mail`, `npm run test:server`, `npm run test:ui`, and `npx playwright test --config playwright.begum-mail.config.mjs`. The Garden tests reuse the existing complete mail behavior suite and add desktop/mobile translation checks. Live Gmail sending requires account authorization and a user-directed test; no email is sent by setup.

Received HTML uses the same safe semantic renderer as the skeuo demo but only Garden styling. Headings, paragraphs, lists, tables, images and safe links are integrated directly into the reader. The optional original-layout disclosure loads its sandboxed frame only when expanded. Plain-text and HTML messages share Garden typography; Original/English toggling uses the same source body and translation cache.
