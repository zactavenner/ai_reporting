import { test, expect } from "../playwright-fixture";

/**
 * Agent Workforce v3 — end-to-end persistence tests.
 *
 * Exercises every seeded agency agent via the same authenticated REST surface
 * the UI uses (supabase JS client wraps PostgREST + Storage). For each agent we
 * verify:
 *   1. Model switching (default_model + fallback_models[]) persists
 *   2. Connector add + remove persists
 *   3. File upload + delete round-trips through `agency_agent_files` + Storage
 *   4. Master vs client override writes hit the right table/scope
 *
 * Auth uses the Lovable-injected Supabase session so policies execute under a
 * real authenticated user.
 */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || "https://jgwwmtuvjlmzapwqiabu.supabase.co";
const ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnd3dtdHV2amxtemFwd3FpYWJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NDkzODIsImV4cCI6MjA4MzMyNTM4Mn0.STFrUoif30xXQCjabc3skP6_tTnVIATwHhwWxeZoUr4";

function getAccessToken(): string {
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  if (sessionJson) {
    try {
      const parsed = JSON.parse(sessionJson);
      if (parsed?.access_token) return parsed.access_token as string;
    } catch {
      /* fall through */
    }
  }
  return (
    process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN || ANON_KEY
  );
}

type Agent = {
  id: string;
  slug: string;
  name: string;
  default_model: string;
  fallback_models: string[] | null;
  connectors: string[] | null;
  memory_md: string | null;
  instructions_md: string | null;
};

const TEST_MODEL_A = "openrouter/owl-alpha";
const TEST_MODEL_B = "google/gemini-2.5-pro";
const TEST_CONNECTOR = "seedance";

test.describe("Agent Workforce v3 — persistence", () => {
  let token: string;
  let agents: Agent[];
  let headers: Record<string, string>;

  test.beforeAll(async ({ request }) => {
    token = getAccessToken();
    headers = {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/agency_agents?select=id,slug,name,default_model,fallback_models,connectors,memory_md,instructions_md&order=sort_order.asc`,
      { headers }
    );
    expect(res.status(), await res.text()).toBe(200);
    agents = await res.json();
    expect(agents.length, "expected seeded agency agents").toBeGreaterThan(0);
  });

  test("every seeded agent has a valid primary model", () => {
    for (const a of agents) {
      expect(a.default_model, `${a.name} missing default_model`).toBeTruthy();
    }
  });

  test("model switching persists for each agent", async ({ request }) => {
    for (const agent of agents) {
      const original = {
        default_model: agent.default_model,
        fallback_models: agent.fallback_models || [],
      };
      const target =
        agent.default_model === TEST_MODEL_A ? TEST_MODEL_B : TEST_MODEL_A;
      const fallbacks = [TEST_MODEL_A, "openai/gpt-5-mini"].filter(
        (m) => m !== target
      );

      const patch = await request.patch(
        `${SUPABASE_URL}/rest/v1/agency_agents?id=eq.${agent.id}`,
        {
          headers,
          data: { default_model: target, fallback_models: fallbacks },
        }
      );
      expect(patch.status(), `patch ${agent.name}`).toBe(200);
      const [updated] = await patch.json();
      expect(updated.default_model).toBe(target);
      expect(updated.fallback_models).toEqual(fallbacks);

      // restore
      const restore = await request.patch(
        `${SUPABASE_URL}/rest/v1/agency_agents?id=eq.${agent.id}`,
        { headers, data: original }
      );
      expect(restore.status()).toBe(200);
    }
  });

  test("connector add + remove persists for each agent", async ({ request }) => {
    for (const agent of agents) {
      const original = agent.connectors || [];
      const next = Array.from(new Set([...original, TEST_CONNECTOR]));

      const add = await request.patch(
        `${SUPABASE_URL}/rest/v1/agency_agents?id=eq.${agent.id}`,
        { headers, data: { connectors: next } }
      );
      expect(add.status()).toBe(200);
      expect((await add.json())[0].connectors).toContain(TEST_CONNECTOR);

      const removed = next.filter((c) => c !== TEST_CONNECTOR);
      const remove = await request.patch(
        `${SUPABASE_URL}/rest/v1/agency_agents?id=eq.${agent.id}`,
        { headers, data: { connectors: removed } }
      );
      expect(remove.status()).toBe(200);
      expect((await remove.json())[0].connectors || []).not.toContain(
        TEST_CONNECTOR
      );

      // restore exact original
      await request.patch(
        `${SUPABASE_URL}/rest/v1/agency_agents?id=eq.${agent.id}`,
        { headers, data: { connectors: original } }
      );
    }
  });

  test("file upload + delete round-trips for each agent (master scope)", async ({
    request,
  }) => {
    for (const agent of agents) {
      const fileName = `e2e-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.txt`;
      const storagePath = `${agent.id}/master/${fileName}`;
      const body = `e2e test file for ${agent.slug}\n`;

      const upload = await request.post(
        `${SUPABASE_URL}/storage/v1/object/agent-files/${storagePath}`,
        {
          headers: {
            apikey: ANON_KEY,
            Authorization: `Bearer ${token}`,
            "Content-Type": "text/plain",
            "x-upsert": "false",
          },
          data: body,
        }
      );
      expect(upload.status(), `upload ${agent.name}: ${await upload.text()}`)
        .toBeLessThan(300);

      const insert = await request.post(
        `${SUPABASE_URL}/rest/v1/agency_agent_files`,
        {
          headers,
          data: {
            agent_id: agent.id,
            client_id: null,
            name: fileName,
            mime: "text/plain",
            size_bytes: body.length,
            lines: 1,
            storage_path: storagePath,
          },
        }
      );
      expect(insert.status(), `insert row ${agent.name}`).toBe(201);
      const row = (await insert.json())[0];
      expect(row.id).toBeTruthy();

      const list = await request.get(
        `${SUPABASE_URL}/rest/v1/agency_agent_files?agent_id=eq.${agent.id}&storage_path=eq.${encodeURIComponent(storagePath)}&select=id,storage_path`,
        { headers }
      );
      expect(list.status()).toBe(200);
      expect((await list.json()).length).toBe(1);

      const del = await request.delete(
        `${SUPABASE_URL}/rest/v1/agency_agent_files?id=eq.${row.id}`,
        { headers }
      );
      expect(del.status()).toBeLessThan(300);

      const rm = await request.delete(
        `${SUPABASE_URL}/storage/v1/object/agent-files/${storagePath}`,
        {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
        }
      );
      expect(rm.status()).toBeLessThan(400);
    }
  });

  test("master memory edit persists and reloads for each agent", async ({
    request,
  }) => {
    for (const agent of agents) {
      const stamp = `e2e-master-${Date.now()}`;
      const original = {
        memory_md: agent.memory_md,
        instructions_md: agent.instructions_md,
      };

      const patch = await request.patch(
        `${SUPABASE_URL}/rest/v1/agency_agents?id=eq.${agent.id}`,
        {
          headers,
          data: { memory_md: stamp, instructions_md: `${stamp}-instr` },
        }
      );
      expect(patch.status()).toBe(200);

      const reload = await request.get(
        `${SUPABASE_URL}/rest/v1/agency_agents?id=eq.${agent.id}&select=memory_md,instructions_md`,
        { headers }
      );
      const [reloaded] = await reload.json();
      expect(reloaded.memory_md).toBe(stamp);
      expect(reloaded.instructions_md).toBe(`${stamp}-instr`);

      await request.patch(
        `${SUPABASE_URL}/rest/v1/agency_agents?id=eq.${agent.id}`,
        { headers, data: original }
      );
    }
  });

  test("client override writes to client_agent_overrides without touching master", async ({
    request,
  }) => {
    const clientsRes = await request.get(
      `${SUPABASE_URL}/rest/v1/clients?select=id,name&limit=1`,
      { headers }
    );
    expect(clientsRes.status()).toBe(200);
    const clients = await clientsRes.json();
    test.skip(clients.length === 0, "no clients available for override test");
    const clientId = clients[0].id as string;

    for (const agent of agents) {
      const stamp = `e2e-client-${Date.now()}`;
      const masterBefore = await request.get(
        `${SUPABASE_URL}/rest/v1/agency_agents?id=eq.${agent.id}&select=memory_md,instructions_md`,
        { headers }
      );
      const masterSnapshot = (await masterBefore.json())[0];

      const upsert = await request.post(
        `${SUPABASE_URL}/rest/v1/client_agent_overrides`,
        {
          headers: {
            ...headers,
            Prefer: "return=representation,resolution=merge-duplicates",
          },
          data: {
            client_id: clientId,
            agent_id: agent.id,
            memory_md: stamp,
            instructions_md: `${stamp}-instr`,
          },
        }
      );
      expect(upsert.status(), `override upsert ${agent.name}: ${await upsert.text()}`)
        .toBeLessThan(300);

      const reload = await request.get(
        `${SUPABASE_URL}/rest/v1/client_agent_overrides?client_id=eq.${clientId}&agent_id=eq.${agent.id}&select=memory_md,instructions_md`,
        { headers }
      );
      const [override] = await reload.json();
      expect(override.memory_md).toBe(stamp);
      expect(override.instructions_md).toBe(`${stamp}-instr`);

      // master must remain untouched
      const masterAfter = await request.get(
        `${SUPABASE_URL}/rest/v1/agency_agents?id=eq.${agent.id}&select=memory_md,instructions_md`,
        { headers }
      );
      const masterNow = (await masterAfter.json())[0];
      expect(masterNow.memory_md).toBe(masterSnapshot.memory_md);
      expect(masterNow.instructions_md).toBe(masterSnapshot.instructions_md);

      // cleanup override row
      await request.delete(
        `${SUPABASE_URL}/rest/v1/client_agent_overrides?client_id=eq.${clientId}&agent_id=eq.${agent.id}`,
        { headers }
      );
    }
  });
});