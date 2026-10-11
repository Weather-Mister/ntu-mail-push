# Cached egress investigation — 10 October 2026

## Finding

The Supabase project named `hanzi` is shared by Hanzi Steps, NTU schedules, and Eren Mail. The observed cached bandwidth is an Eren Mail outbox crash/retry loop, not Hanzi images or audio.

Read-only production inspection found three Storage objects: one private `eren-mail-attachments` object of 9,086,982 bytes and two private `schedule-transfer` objects totaling 228,538 bytes. No Hanzi media bucket exists. No mail bodies, attachment contents, credentials, or user progress were downloaded for this investigation.

In the fixed window **9 October 13:00 to 10 October 13:00 Taiwan time** (05:00 UTC to 05:00 UTC), the same outbox attachment generated **554 HTTP 200 cache HIT responses**, each 9,086,982 bytes: **5,034,188,028 bytes (5.034 GB)**. The client was the project's Deno/Supabase Edge runtime, not a browser. Full hours had approximately 21–25 downloads. Response Content-Length sums are an estimate of delivered response bodies, not an independently reconciled billing export.

Other sampled windows:

| Window (UTC) | Attachment downloads | Reported cached bytes |
| --- | ---: | ---: |
| Oct 5 00:00–Oct 6 00:00 | 301 HITs, plus 3 MISSes | 2,735,181,582 |
| Oct 6 00:00–Oct 7 00:00 | 477 HITs | 4,334,490,414 |
| Oct 7 05:00–Oct 8 05:00 | 482 | 4,379,925,324 total reported bytes |
| Oct 8 05:00–Oct 9 05:00 | 496 | 4,507,143,072 total reported bytes |
| Oct 9 05:00–Oct 10 05:00 | 554 HITs | 5,034,188,028 |

These windows are samples, not a contiguous billing reconciliation. The user's screenshot reports 24.329 GB cached egress. The available evidence strongly explains its scale, but the screenshot's billing-period boundaries were not available.

## Failure chain

1. Eren's minute cron claims the same queued email. At inspection it had **2,708 attempts**, remained `processing`, and had been queued on October 5.
2. `deliver()` downloads its 9.09 MB attachment and builds MIME.
3. `b64()` formerly concatenated a one-character string for every byte of the complete MIME message. Reproducing the deployed encoder with synthetic input of the same size reached **680,906,752 bytes peak process RSS** on local Node 24.
4. Production Eren v17 logs show **563 shutdowns with reason `Memory`** in a sampled rolling 24 hours, up to 271,995,385 reported memory bytes. [Supabase documents a 256 MB Edge memory limit](https://supabase.com/docs/guides/functions/limits).
5. Runtime termination bypasses the JavaScript catch handler. Its `attempts < 5` retry check never executes. The SQL claim function reclaims any expired `processing` job without checking attempts. The two-minute lease then drives another download and crash indefinitely.

The checked-out Eren function files at `d23ad88b7a980e657bd02479aebe0ad2c889e624` all matched deployed version 17 exactly before editing.

## Repair

- Use native base64/base64url encoding, respecting typed-array offsets. Decode legacy data without `Array.from`'s per-byte temporary allocation; retain strict input validation.
- Assemble folded attachment MIME directly in one allocated buffer, avoiding a per-line match array and an additional complete MIME string. Preserve Unicode headers, filename encoding, text/HTML alternatives, binary bytes, the 20 MiB total attachment allowance, and existing API behavior.
- Enforce the five-attempt budget in `eren_mail_claim`, including expired leases after hard crashes. Exhausted jobs become `failed`, preserving their payload reference and all Storage assets for the existing Outbox recovery flow. Active leases, future scheduled jobs, sent/cancelled/uncertain/sending jobs are not reclaimed. Keep one-job batches, `SKIP LOCKED`, invoker security and service-role-only access.
- Verify claim ownership before downloading and again at the send boundary. A stale attempt cannot send or change its successor's state.

No production data was changed while preparing this repair. No live email was sent. No storage objects were deleted, feature switched off, migration applied, function deployed, or PR merged during local validation.

## Hanzi audit

Inspected current Hanzi main `dc4630c3253c6369ab6d6cc341e8a7d1e9bd1e80`:

- `pages/supabase.ts` points to the same project; progress uses RPCs. The sampled logs show normal small progress writes with `DYNAMIC` cache status, separate from the attachment traffic.
- `lib/use-speech.ts` uses device `speechSynthesis`; there is no Supabase audio download or audio preload.
- Character artwork imports bundled `lib/stroke-data.json`; exercises use SVG illustrations. Country flags are same-origin static SVGs under `public/extras/flags`.
- `public/push-sw.js` handles push notifications and notification clicks only. It has no fetch handler, precache, or network-first asset loop.
- There is no Storage media loader, signed media URL generation, or Supabase media preloading path in the audited frontend. No evidence justifies changing Hanzi's caching, login, progress sync, curriculum, or UI for this incident. Its source remains unchanged.

## Validation and expected reduction

- Final local checks: **37 Node tests passed**, **27 Deno server tests passed** (both Deno 2.9.6 and production's 2.1.4 runtime version), worker type-check passed after a clean dependency install, and **82 desktop/mobile browser tests passed** (6 existing viewport-specific skips). Browser tests use mocked APIs and installed Chrome; no live mail or user data is altered.
- Synthetic attachment byte-for-byte round trips, Unicode names, base64 padding, typed-array slices, malformed input, MIME folding and the 20 MiB boundary.
- Separate-process memory benchmark: the 9,086,982-byte case fell from **681 MB to 126 MB** peak RSS (about **81% lower**); the 20 MiB case used approximately **194 MB**. These are local process measurements, not hosted Edge peak guarantees.
- Local PostgreSQL (PGlite) executes the actual guard SQL. Five simulated crashes exhaust the budget; 50 more ticks claim nothing. The existing 2,708-attempt pattern becomes recoverable failure. Tests cover future jobs, active leases, one-job claims, targeted claims, untouched terminal/uncertain states, and restricted execute grants.
- Mocked server tests cover one download/one delivery for an incident-sized attachment, stale/cancelled claims, transient errors, ambiguous-send reconciliation, OAuth, workspace isolation and existing mail operations. No live Gmail calls occur.

For the already exhausted incident job, the guard should eliminate **all subsequent automatic attachment downloads after its current lease expires**. That projects to approximately **5.03 GB/day avoided** at the last measured rate (~151 GB per 30 days if that rate otherwise continued). A newly crashing job is bounded to five attempts: at most 45.4 MB for this attachment, instead of unbounded repeated downloads. This estimate is specific to the confirmed loop; it is not a promise about all future project traffic.

## Rollout and verification

1. Apply only the reviewed retry-guard migration first. Do not reset the incident job's attempts or requeue it. After the existing lease expires, the normal cron should mark it failed and continue other work. This prevents deployment from unexpectedly sending the five-day-old email.
2. Verify that the incident row is failed, attempt count has stopped, its payload reference still exists, and the Storage object count/size is unchanged.
3. Deploy the reviewed Eren Mail function with the existing authentication configuration. Retain the original v17 function bundle as a rollback reference. Do not weaken access checks or change browser caching for private attachments.
4. Inspect at least 10 minutes of post-rollout logs, then a full-day window: no further automatic downloads for this outbox object; no recurring Memory shutdowns; cron still completes; normal queue/mail synchronization continues. Do not invoke a worker manually as a test because it may send real queued messages.
5. The user can recover the stalled draft from Outbox and decide whether to send it. Do not automatically replay it during verification.

If encoding changes need rollback, roll back the function code while keeping the retry guard. Removing the guard while a pathological job is pending can restart the bandwidth loop.

Remaining limits: hosted runtime memory can differ from local tests. A separate diagnostic including JSON serialization used about **159 MB** for the incident-sized attachment and **270 MB** for 20 MiB. The maximum-size full request still needs hosted verification and may require a streaming upload follow-up; the unchanged 20 MiB validation allowance is not a guarantee that every maximum-size request will fit the hosted limit. The database budget prevents repeated failures from causing unlimited downloads. Historical billing totals were not independently reconciled. Security advisors also reported pre-existing public Hanzi SECURITY DEFINER RPC warnings; those are outside this bandwidth patch and were not modified ([advisor documentation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)).

Supabase's distinction between CDN cached egress and client caching is described in its [egress guide](https://supabase.com/docs/guides/platform/manage-your-usage/egress). A CDN cache HIT still transfers bytes to this repeatedly crashing worker.
