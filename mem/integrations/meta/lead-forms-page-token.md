---
name: Meta lead forms need a Page Access Token
description: /{page-id}/leadgen_forms rejects ad-account tokens; exchange per-page tokens in meta-leadforms-sync.
type: feature
---
`/{page-id}/leadgen_forms` returns OAuth error #190 ("must be called with a Page Access Token") when called with a user/system-user or shared ad-account token. `meta-leadforms-sync` exchanges a page token first via `GET /{page-id}?fields=access_token&access_token=<user token>`, then lists forms with that page token. Token priority: `meta_system_user_token` → `meta_access_token` → `META_SHARED_ACCESS_TOKEN`.

Google Sheets mirror in `sync-meta-ad-spend`: reads are quota-capped per minute. One `A2:N` read per spreadsheet per run (cached), a ~350ms floor gap between gateway calls, and 429/5xx backoff honoring `Retry-After`. Non-429 4xx never retries.
