import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildJeremyContextLines, buildJeremyOutbound } from "./jeremyContext.ts";

const brain = { voice: "Institutional but plain-spoken", icp: "Accredited investors 45+", brand_guidelines: "No hype", do_not_say: "guaranteed" };

const offers = [
  {
    title: "Fund II",
    fund_name: "Capital Growth Fund II",
    raise_amount: "$25M",
    targeted_returns: "12-14% targeted",
    min_investment: "$50,000",
    reg_d_type: "506(c)",
    accredited_only: true,
    created_at: "2026-01-10T10:00:00Z",
    updated_at: "2026-07-30T18:00:00Z",
  },
  {
    title: "Fund I",
    fund_name: "Capital Growth Fund I",
    raise_amount: "$10M",
    created_at: "2025-03-01T10:00:00Z",
    updated_at: "2025-06-01T10:00:00Z",
  },
];

const input = { clientName: "Acme Capital", brain, offers, clientId: "c-1" };

Deno.test("offer context is included on the first turn", () => {
  const out = buildJeremyOutbound("What should the hook be?", input);
  assertStringIncludes(out, "[CONTEXT");
  assertStringIncludes(out, "Client in scope: Acme Capital");
  assertStringIncludes(out, "Capital Growth Fund II");
  assertStringIncludes(out, "What should the hook be?");
});

Deno.test("full offer context is re-sent on EVERY turn, not just the first", () => {
  const turns = ["turn 1", "turn 2", "turn 3", "turn 4"];
  for (const t of turns) {
    const out = buildJeremyOutbound(t, input);
    assertStringIncludes(out, "[CONTEXT");
    assertStringIncludes(out, "Client in scope: Acme Capital");
    assertStringIncludes(out, "Capital Growth Fund II");
    assertStringIncludes(out, "Targeted returns: 12-14% targeted");
    assertStringIncludes(out, "Min investment: $50,000");
    assertStringIncludes(out, "Reg D: 506(c)");
    assertStringIncludes(out, "ICP: Accredited investors 45+");
    assertStringIncludes(out, `[MESSAGE]\n${t}`);
  }
});

Deno.test("every offer carries created/updated timestamps", () => {
  const lines = buildJeremyContextLines(input);
  const offerLines = lines.filter((l) => l.startsWith("- "));
  assertEquals(offerLines.length, 2);
  for (const l of offerLines) {
    assertStringIncludes(l, "Last updated: ");
    assertStringIncludes(l, "Created: ");
  }
});

Deno.test("context carries a refresh timestamp for the current turn", () => {
  const now = new Date("2026-08-03T15:00:00Z");
  const lines = buildJeremyContextLines({ ...input, now });
  assertEquals(lines[0], "Context timestamp (UTC): 2026-08-03T15:00:00.000Z");
});

Deno.test("most recently updated offer is listed first and flagged", () => {
  // Feed them oldest-first to prove the builder sorts, not the caller.
  const lines = buildJeremyContextLines({ ...input, offers: [offers[1], offers[0]] });
  const offerLines = lines.filter((l) => l.startsWith("- "));
  assertStringIncludes(offerLines[0], "Capital Growth Fund II");
  assertStringIncludes(offerLines[0], "MOST RECENT");
  assertStringIncludes(offerLines[1], "Capital Growth Fund I");
  assert(!offerLines[1].includes("MOST RECENT"));
  assertStringIncludes(
    lines.join("\n"),
    "newest first, treat the first entry as the current source of truth",
  );
});

Deno.test("updated offer text propagates on the next turn", () => {
  const t1 = buildJeremyOutbound("turn 1", input);
  assertStringIncludes(t1, "Raise: $25M");
  const updated = [{ ...offers[0], raise_amount: "$40M", updated_at: "2026-08-03T12:00:00Z" }, offers[1]];
  const t2 = buildJeremyOutbound("turn 2", { ...input, offers: updated });
  assertStringIncludes(t2, "Raise: $40M");
  assertStringIncludes(t2, "Last updated: 2026-08-03T12:00:00Z");
  assert(!t2.includes("Raise: $25M"));
});

Deno.test("missing offers produce an explicit no-offer instruction every turn", () => {
  for (const t of ["a", "b"]) {
    const out = buildJeremyOutbound(t, { clientName: "Acme Capital", brain: null, offers: [], clientId: "c-1" });
    assertStringIncludes(out, "No offer is configured for this client yet");
  }
});
