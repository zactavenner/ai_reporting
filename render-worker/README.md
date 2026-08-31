# Reporting 5.0 HyperFrames worker

This is the server half of the in-app MP4 renderer. It is not deployed or enabled by installing the npm dependency alone.

## Deployment gates

1. Deploy `20260831152232_hyperframes_render_jobs.sql` and the `hyperframes-jobs` Edge Function to the **same Supabase project used by the app**. This checkout points to `jgwwmtuvjlmzapwqiabu`; do not deploy into a similarly named database. Include `_shared/dashboard-auth.ts` and `_shared/hyperframes-spec.mjs` in the function deployment.
2. Deploy signed dashboard-session issuance from the existing authentication work. The render endpoint rechecks `agency_members` and permits only current admin/owner members. The job and worker tables deny direct browser access.
3. Install the separate worker runtime with `npm install --prefix render-worker` (Node 22+, FFmpeg, and a working HyperFrames Chromium installation required).
4. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the worker's server-only environment. Never put the key in a `VITE_*` variable, a committed file, or the frontend. No publishable-key fallback is supported.
5. Run `npm run hyperframes:worker -- --watch` on the rendering host. The app refuses to submit if no heartbeat has been seen for 90 seconds. Local-host mode requires this machine to remain awake and online; for always-on app rendering, deploy this same worker to a suitable server or configure managed HeyGen rendering separately.
6. Deploy the frontend changes, sign in again, choose a client, review the edit, and approve the MP4 render. A successful render appears as a **pending** creative, never approved or launched automatically.

## Verification still required before rollout

- Run `npm run hyperframes:test` and the frontend build.
- Test unauthenticated and non-admin denial, cross-client source rejection, concurrent claims, repeated request IDs and repeated completion calls against the deployed database.
- Submit a real authorized job through the UI; verify source timing, audio, captions and every frame of the result. Read back the job, pending creative and playable storage URL under the selected client.
- Current renderer supports cuts, trims, constant speed, source audio, voiceover, static text, and Classic/Minimal/Boxed captions. Other effects are explicitly rejected. Add and verify full effect parity before treating this as a replacement for all editor features.

## Failure recovery

There is no automatic rerender of failed or interrupted jobs. Local artifacts remain under ignored `render-worker/jobs/`. If a worker dies, inspect its claimed job and any uploaded output before an operator resets it. A completion-response timeout must be reconciled by reading the job before creating another job. Final uploads use unique client/job paths with no overwrite. The completion RPC publishes the pending creative and terminal job state in one transaction.

The application currently has pre-existing broad policies on other tables and storage. This change does not claim to harden that wider system; its own queue has no anonymous access.
