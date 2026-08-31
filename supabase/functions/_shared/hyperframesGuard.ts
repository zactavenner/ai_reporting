/**
 * HyperFrames server rendering kill-switch.
 *
 * Security review finding: this app's legacy operator gate (`verify-password`)
 * accepts a shared fallback password plus a CALLER-SELECTED member name, and
 * `agency_members` was historically publicly writable. An HMAC dashboard
 * session plus a role re-read therefore does NOT prove that the caller is an
 * independently authenticated render operator. Until a real per-operator
 * credential and protected membership/authorization exist and are verified,
 * server-side rendering must stay fail-closed.
 *
 * Rendering is enabled ONLY when HYPERFRAMES_RENDERING_ENABLED is explicitly
 * the string "true". Absent, empty, malformed or any other value => disabled.
 * Never set this flag as part of an integration; it is an activation decision.
 */
export const RENDERING_DISABLED_BODY = {
  error:
    'rendering_disabled: HyperFrames server rendering is disabled until an independently authenticated render operator is configured.',
  code: 'rendering_disabled',
} as const;

export function isRenderingEnabled(
  raw: string | undefined | null = Deno.env.get('HYPERFRAMES_RENDERING_ENABLED'),
): boolean {
  return raw === 'true';
}
