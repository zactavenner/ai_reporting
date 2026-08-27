/**
 * Soul registry.
 *
 * A soul is the persona layer for a named agent: identity, beliefs, voice,
 * craft, conscience, and the standard it holds itself to. It is prepended to
 * whatever task prompt the agent is given, so the same agent behaves like the
 * same character across every surface that runs it.
 *
 * Keyed by `agents.template_key` so run-agent can resolve one without the
 * caller having to know it exists.
 */
import { buildHermesSystemPrompt } from './hermes.ts';

export * from './hermes.ts';

const SOUL_BUILDERS: Record<string, () => string> = {
  hermes: () => buildHermesSystemPrompt(),
};

/** Returns the soul prompt for a template key, or null when the agent has none. */
export function getSoulSystemPrompt(templateKey: string | null | undefined): string | null {
  if (!templateKey) return null;
  const build = SOUL_BUILDERS[templateKey];
  return build ? build() : null;
}

export function hasSoul(templateKey: string | null | undefined): boolean {
  return !!templateKey && templateKey in SOUL_BUILDERS;
}
