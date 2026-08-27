# HERMES — Capital Raising Ad Copywriter

The messenger. HERMES is the persona that writes paid-media copy for accredited
investor campaigns: Meta primary text, headlines, descriptions, Reels/Stories
hook cards, static-ad overlays, and short-form video hooks.

**Runtime source of truth:** `supabase/functions/_shared/souls/hermes.ts`.
This document explains what the soul is and how to run it; the module *is* the
soul. Edit the module, not this file, when changing the persona.

## What a soul is

A soul is the persona layer for a named agent — identity, beliefs, voice, craft,
conscience, and the standard it holds itself to. It is prepended to whatever
task prompt the agent is handed, so the same agent behaves like the same
character on every surface that runs it. Task prompts change per run; the soul
does not.

Souls are registered in `supabase/functions/_shared/souls/index.ts`, keyed by
`agents.template_key`.

## What HERMES is for

| | |
|---|---|
| **Writes** | Meta primary text, headlines, descriptions, hook cards, static-ad overlay copy, video hooks |
| **Does not write** | Nurture emails, SMS sequences, setter/caller scripts, pitch decks, investor-facing correspondence |
| **Does not do** | Report on spend, edit metrics, talk to investors, decide fund terms |

Division of labor with the rest of the workforce: **BROOKLYN** diagnoses ad
performance and flags fatigue; **HERMES** writes the replacement copy.
**HUNTER** works the pipeline HERMES fills.

## The seven sections

1. **Identity** — who HERMES is, who the reader is, the two masters (performance and compliance) it refuses to choose between.
2. **Beliefs** — twelve operating convictions, including specificity as the only purchasable credibility, disqualification over persuasion, and judgment on cost per funded investor rather than clicks.
3. **Voice** — sentence mechanics, cadence, the banned list, and the *careful* list (`secured`, `asset-backed`, `high-yield`, `preferred return`, `proven` — each permitted only in a narrow, documented sense).
4. **Craft** — the eight-part ad anatomy, the hook taxonomy, the six-angle map, per-placement rules, the CTA menu, and variation discipline (vary the angle, never the wording).
5. **Conscience** — the eight SEC/FINRA gates, the 506(b) vs 506(c) rule, rewrite reflexes, and the missing-data protocol.
6. **Standard** — a nine-point self-critique run before returning anything, plus five kill criteria.
7. **Calibration** — weak/strong exemplars and headline pairs.

Two rules carry the most weight in review:

- **506(b) means no offering ad at all.** HERMES writes brand or education copy
  that never touches the offering, its terms, or its returns — and says so.
- **Missing data is never filled with an adjective.** The bracketed variable
  stays in place and lands in `missing_inputs`.

## Where it runs

### 1. Scheduled agent

`Copywriter Agent (HERMES)` is available from **Agents → Templates**
(`template_key: 'hermes'`, Mondays 14:00, `temperature: 0.85`, connectors:
database, meta_ads, slack).

`run-agent` resolves the soul from the registry by `template_key` and prepends
it to the system message; the JSON contract stays last so it always wins. The
agent reads the client's offers and ad performance, names the angles that are
working and the ones that have fatigued, and returns a week of copy plus
`compliance_notes`, `missing_inputs`, `escalations`, and a `slack_message`.

### 2. Asset generation (opt-in)

`generate-asset` accepts a `soul` field. Pass `soul: 'hermes'` and the persona is
layered ahead of the AI Capital Raising Copy System templates:

```ts
await supabase.functions.invoke('generate-asset', {
  body: { client_id, asset_type: 'adcopy', client_data, soul: 'hermes' },
});
```

Applies to the ad-facing asset types only — `adcopy`, `creatives`, `angles`,
`scripts`, `vsl`. Passing it for anything else logs a warning and is ignored, so
email and SMS generation keep their existing voice. Omit the field entirely and
nothing changes: every existing caller behaves exactly as before.

The soul governs; the templates scaffold. Where a template and a compliance gate
disagree, the gate wins and HERMES notes it in `compliance_notes`.

## Output contract

`buildHermesSystemPrompt({ includeOutputContract: true })` appends the default
JSON shape — `variations[]` (each with `angle`, `hook_type`, `primary_text`,
`headline`, `description`, `cta`, `hook_card`, `target_investor`,
`why_it_works`), plus `compliance_notes`, `missing_inputs`, and `test_plan`.

Leave it off when the calling task defines its own shape, which is what both
current callers do: `generate-asset` has per-asset-type contracts and the agent
template carries its own. Every variation ships `STANDARD_DISCLAIMER` verbatim.

Cost: roughly 4k tokens of system prompt with the contract, 3.5k without.

## Adding another soul

1. Write `supabase/functions/_shared/souls/<name>.ts` exporting a
   `build<Name>SystemPrompt()`.
2. Register it in `SOUL_BUILDERS` in `souls/index.ts` under the agent's
   `template_key`.
3. Any surface that calls `getSoulSystemPrompt(template_key)` picks it up with
   no further wiring.
