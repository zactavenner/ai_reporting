import { describe, expect, it } from "vitest";
import {
  extractContentUrl,
  extractCostUsd,
  extractProviderError,
  isVideoContentType,
  nextWorkflowState,
  openRouterPollUrl,
  type OpenRouterVideoJob,
} from "../../supabase/functions/_shared/h3Provider";

/**
 * Verbatim live response from
 *   GET https://openrouter.ai/api/v1/videos/kp44Cr1RWZpdvOGJe28H
 * captured with the server-side OpenRouter credential. The content URL was
 * confirmed to return HTTP 200 video/mp4 (ISO Media MP4) with the key, and 401
 * without it.
 */
const REAL_COMPLETED: OpenRouterVideoJob = {
  id: "kp44Cr1RWZpdvOGJe28H",
  generation_id: "gen-vid-1785900920-PWW9fBPlH5IAii1YUyQ1",
  polling_url: "https://openrouter.ai/api/v1/videos/kp44Cr1RWZpdvOGJe28H",
  status: "completed",
  unsigned_urls: ["https://openrouter.ai/api/v1/videos/kp44Cr1RWZpdvOGJe28H/content?index=0"],
  usage: { cost: 1.95, is_byok: false },
};

describe("OpenRouter poll endpoint", () => {
  it("is a GET on /videos/{id} — never a generation endpoint", () => {
    const url = openRouterPollUrl("kp44Cr1RWZpdvOGJe28H");
    expect(url).toBe("https://openrouter.ai/api/v1/videos/kp44Cr1RWZpdvOGJe28H");
    expect(url).not.toMatch(/generation|chat\/completions/);
  });

  it("encodes the job id", () => {
    expect(openRouterPollUrl("a/b?c")).toBe("https://openrouter.ai/api/v1/videos/a%2Fb%3Fc");
  });
});

describe("persisted fields from the real payload", () => {
  it("pulls generation_id, polling_url, cost and the content URL", () => {
    expect(REAL_COMPLETED.generation_id).toBe("gen-vid-1785900920-PWW9fBPlH5IAii1YUyQ1");
    expect(REAL_COMPLETED.polling_url).toBe("https://openrouter.ai/api/v1/videos/kp44Cr1RWZpdvOGJe28H");
    expect(extractCostUsd(REAL_COMPLETED)).toBe(1.95);
    expect(extractContentUrl(REAL_COMPLETED)).toBe(
      "https://openrouter.ai/api/v1/videos/kp44Cr1RWZpdvOGJe28H/content?index=0",
    );
    expect(extractProviderError(REAL_COMPLETED)).toBeNull();
  });

  it("reports no cost when usage is absent rather than inventing zero", () => {
    expect(extractCostUsd({ status: "pending" })).toBeNull();
    expect(extractCostUsd({ status: "completed", usage: {} })).toBeNull();
  });

  it("tolerates the other documented content shapes", () => {
    expect(extractContentUrl({ content: [{ url: "https://x/v.mp4" }] })).toBe("https://x/v.mp4");
    expect(extractContentUrl({ output: [{ video: { url: "https://y/v.mp4" } }] })).toBe("https://y/v.mp4");
    expect(extractContentUrl({ signed_urls: "https://z/v.mp4" })).toBe("https://z/v.mp4");
    expect(extractContentUrl({ status: "pending" })).toBeNull();
    expect(extractContentUrl({ unsigned_urls: ["not-a-url"] })).toBeNull();
  });

  it("captures a provider error in either string or object form", () => {
    expect(extractProviderError({ error: "quota exceeded" })).toBe("quota exceeded");
    expect(extractProviderError({ error: { code: 400, message: "bad" } })).toContain("bad");
  });
});

describe("status -> workflow state mapping", () => {
  it("pending holds at Submitted", () => {
    expect(nextWorkflowState({ current: "submitted", providerStatus: "pending", assetVerified: false })).toBeNull();
  });

  it("in_progress advances Submitted to Rendering", () => {
    expect(nextWorkflowState({ current: "submitted", providerStatus: "in_progress", assetVerified: false })).toBe("rendering");
  });

  it("in_progress holds a job already at Rendering", () => {
    expect(nextWorkflowState({ current: "rendering", providerStatus: "in_progress", assetVerified: false })).toBeNull();
  });

  it("completed reaches Downloaded ONLY with a verified asset", () => {
    expect(nextWorkflowState({ current: "rendering", providerStatus: "completed", assetVerified: true })).toBe("downloaded");
    expect(nextWorkflowState({ current: "submitted", providerStatus: "completed", assetVerified: true })).toBe("downloaded");
  });

  it("completed without a downloadable asset never advances", () => {
    expect(nextWorkflowState({ current: "rendering", providerStatus: "completed", assetVerified: false })).toBeNull();
    expect(nextWorkflowState({ current: "submitted", providerStatus: "completed", assetVerified: false })).toBeNull();
  });

  it("failed and unknown statuses hold position", () => {
    for (const s of ["failed", "cancelled", "queued", "", "weird"]) {
      expect(nextWorkflowState({ current: "rendering", providerStatus: s, assetVerified: false })).toBeNull();
    }
  });

  it("never touches states the provider does not own", () => {
    for (const s of ["draft", "claim_review", "downloaded", "qa", "ready_for_review", "approved", "meta_ready"]) {
      expect(nextWorkflowState({ current: s, providerStatus: "completed", assetVerified: true })).toBeNull();
    }
  });

  it("maps the real completed payload to Downloaded once verified", () => {
    const verified = !!extractContentUrl(REAL_COMPLETED);
    expect(nextWorkflowState({ current: "submitted", providerStatus: REAL_COMPLETED.status!, assetVerified: verified })).toBe("downloaded");
  });
});

describe("asset content-type gate", () => {
  it("accepts real video responses", () => {
    expect(isVideoContentType("video/mp4")).toBe(true);
    expect(isVideoContentType("application/octet-stream")).toBe(true);
  });

  it("rejects an error page masquerading as an asset", () => {
    for (const t of ["text/html", "application/json", ""]) {
      expect(isVideoContentType(t)).toBe(false);
    }
  });
});
