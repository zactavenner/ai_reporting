## Goal
Make the Google Doc that AI Studio reads/edits truly per-client, instead of falling back to the agency-wide doc.

## Today
- `AIStudioTab` already has a Google Doc URL input. Whatever you type is saved on `ai_studio_conversations.doc_url` (per user + client) and passed to the `ai-studio` edge function, which already supports `append_to_doc` and `find_replace_in_doc` via the Google Docs connector.
- If the conversation has no `doc_url`, it currently falls back to `agencySettings.kpi_google_doc_url` (one URL for the whole agency). `client_settings.kpi_google_doc_url` exists in the schema but isn't used here, and no client has it set.

## Change
Frontend-only, in `src/components/ai/AIStudioTab.tsx`:

1. Load per-client settings via `useClientSettings(clientId)` alongside `useAgencySettings`.
2. Update the default-URL effect (currently lines 103–107) to use this priority:
   - conversation `doc_url` (already loaded) →
   - `clientSettings.kpi_google_doc_url` →
   - `agencySettings.kpi_google_doc_url`.
   Same change for `sheet_url` → `clientSettings.kpi_google_sheet_url` → agency.
3. Add a small "Save as default for this client" button next to the Doc URL input (and Sheet URL input). On click, upsert via `useUpdateClientSettings` so the URL becomes this client's default for everyone, not just the current user's conversation.
4. Show a tiny badge under the input indicating the source ("client default" / "agency default" / "conversation override") so it's obvious where the URL came from.

No backend changes — the existing `ai-studio` function already accepts `docUrl` per request and runs the Docs edits.

## Out of scope
- Embedding a live Google Doc editor in the canvas (Docs API doesn't support that; the current iframe `/preview` is read-only by design).
- Backfilling `kpi_google_doc_url` for existing clients (separate task if you want me to populate from a source like the Master Dashboard sheet).
