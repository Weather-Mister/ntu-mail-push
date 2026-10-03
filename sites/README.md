# Schedule sites

These two PWAs are deliberately separate even though GitHub Pages serves them from one repository.

- `sites/eren/` → `/ntu-mail-push/`
- `sites/begum/` → `/ntu-mail-push/begum/`

Isolation rules:
- separate Supabase workspaces and COOL feeds;
- separate browser localStorage key namespaces;
- separate service-worker cache namespaces;
- Begüm's service worker is scoped to `/begum/`;
- Eren's root service worker explicitly ignores `/begum/`;
- separate push subscriptions and existing GitHub mail secrets/workflows.

Do not combine the two app directories or reuse their storage/cache keys.
