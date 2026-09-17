# NTU Mail → iPhone Push

This private repo checks NTU Mail once per hour and sends one bundled Web Push notification to the NTU Schedule PWA.

## Required GitHub Actions secrets

Repository → Settings → Secrets and variables → Actions → New repository secret

- `NTU_EMAIL` — your NTU email address
- `NTU_PASSWORD` — your NTU Mail password
- `PUSH_SUBSCRIPTION` — copy from NTU Schedule → NTU → Mail alerts → GitHub setup
- `VAPID_PRIVATE_KEY` — copy from the same place

Do not put any of these values directly in repository files.

## First run

Go to Actions → Check NTU Mail → Run workflow.

The first successful run creates a baseline of existing messages and intentionally sends no notification. New messages after that generate one notification per hourly check.

## Schedule

`.github/workflows/check-mail.yml` currently runs at minute 17 of every hour.
