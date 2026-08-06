import { describe, it, expect } from "vitest";
import {
  H3_STATES,
  nextState,
  stateIndex,
  isProviderOwned,
  qaComplete,
  durationWithinTolerance,
  scanFundClaims,
  hasBlockingClaims,
  H3_QA_CHECKS,
  H3_ACCREDITED_CALLOUT,
  type H3QaResults,
} from "@/lib/h3Workflow";

describe("H3 state machine", () => {
  it("orders the nine states exactly as specified", () => {
    expect(H3_STATES).toEqual([
      "draft", "claim_review", "submitted", "rendering",
      "downloaded", "qa", "ready_for_review", "approved", "meta_ready",
    ]);
  });

  it("advances one step at a time and stops at meta_ready", () => {
    expect(nextState("draft")).toBe("claim_review");
    expect(nextState("claim_review")).toBe("submitted");
    expect(nextState("downloaded")).toBe("qa");
    expect(nextState("approved")).toBe("meta_ready");
    expect(nextState("meta_ready")).toBeNull();
  });

  it("never lets nextState skip a state", () => {
    for (const s of H3_STATES) {
      const to = nextState(s);
      if (to) expect(stateIndex(to)).toBe(stateIndex(s) + 1);
    }
  });

  it("marks submitted and rendering as provider-owned only", () => {
    expect(isProviderOwned("submitted")).toBe(true);
    expect(isProviderOwned("rendering")).toBe(true);
    for (const s of H3_STATES.filter((x) => x !== "submitted" && x !== "rendering")) {
      expect(isProviderOwned(s)).toBe(false);
    }
  });
});

describe("H3 QA gate", () => {
  const allPass = (): H3QaResults =>
    Object.fromEntries(H3_QA_CHECKS.map((c) => [c.key, true])) as H3QaResults;

  it("requires every check to pass", () => {
    expect(qaComplete(allPass())).toBe(true);
    expect(qaComplete({})).toBe(false);
  });

  it("fails when any single check is missing or false", () => {
    for (const c of H3_QA_CHECKS) {
      const partial = { ...allPass(), [c.key]: false };
      expect(qaComplete(partial)).toBe(false);
      const dropped = { ...allPass() } as H3QaResults;
      delete dropped[c.key];
      expect(qaComplete(dropped)).toBe(false);
    }
  });

  it("covers the required QA dimensions", () => {
    const keys = H3_QA_CHECKS.map((c) => c.key);
    for (const k of ["decode","duration","aspect","resolution","audio","transcript","captions","disclosures","avatar","artifacts"]) {
      expect(keys).toContain(k);
    }
  });

  it("enforces a 15s duration with 1s tolerance", () => {
    expect(durationWithinTolerance(15)).toBe(true);
    expect(durationWithinTolerance(14)).toBe(true);
    expect(durationWithinTolerance(16)).toBe(true);
    expect(durationWithinTolerance(13.9)).toBe(false);
    expect(durationWithinTolerance(16.1)).toBe(false);
  });
});

describe("AMT fund claim guardrails", () => {
  const compliant = `${H3_ACCREDITED_CALLOUT} A $50,000 minimum applies. Stated preferred annual return paid quarterly before sponsor promote. All investments involve risk of loss.`;

  it("passes compliant copy carrying the required callout", () => {
    expect(hasBlockingClaims(scanFundClaims(compliant))).toBe(false);
  });

  it("returns nothing for empty copy", () => {
    expect(scanFundClaims("")).toEqual([]);
    expect(scanFundClaims("   ")).toEqual([]);
  });

  it("blocks guaranteed / fixed / risk-free style wording", () => {
    for (const bad of [
      "guaranteed returns", "a guarantee of income", "risk-free investment",
      "risk free returns", "no-risk opportunity", "assured income",
      "safe investment for you", "secure returns quarterly", "you can't lose",
      "fixed returns paid quarterly", "fixed annual yield",
    ]) {
      const issues = scanFundClaims(`${H3_ACCREDITED_CALLOUT} ${bad}`);
      expect(hasBlockingClaims(issues), bad).toBe(true);
    }
  });

  it("blocks comparative or performance claims about Washington DC", () => {
    for (const bad of [
      "Washington DC is the best place to invest",
      "DC is the strongest market right now",
      "the top metro for investment",
      "it outperforms everything else",
      "returns that beat the market",
    ]) {
      const issues = scanFundClaims(`${H3_ACCREDITED_CALLOUT} ${bad}`);
      expect(hasBlockingClaims(issues), bad).toBe(true);
      expect(issues.some((i) => i.code === "comparative_claim"), bad).toBe(true);
    }
  });

  it("requires the Accredited Investor callout once terms appear", () => {
    const issues = scanFundClaims("A $50,000 minimum applies, paid quarterly.");
    expect(issues.some((i) => i.code === "missing_accredited_callout")).toBe(true);
    expect(hasBlockingClaims(issues)).toBe(true);
  });

  it("does not demand the callout when no terms are present", () => {
    const issues = scanFundClaims("A short film about the city skyline at dawn.");
    expect(issues.some((i) => i.code === "missing_accredited_callout")).toBe(false);
    expect(hasBlockingClaims(issues)).toBe(false);
  });

  it("warns that Washington DC is thesis context only", () => {
    const issues = scanFundClaims(`${H3_ACCREDITED_CALLOUT} Our thesis centers on Washington, DC. $50,000 minimum.`);
    const dc = issues.find((i) => i.code === "dc_thesis_context");
    expect(dc?.severity).toBe("warning");
    expect(hasBlockingClaims(issues)).toBe(false);
  });

  it("de-duplicates repeated findings", () => {
    const issues = scanFundClaims(`${H3_ACCREDITED_CALLOUT} guaranteed guaranteed guaranteed`);
    const msgs = issues.map((i) => i.message);
    expect(new Set(msgs).size).toBe(msgs.length);
  });
});