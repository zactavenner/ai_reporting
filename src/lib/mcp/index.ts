import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listClients from "./tools/list-clients";
import getClientMetrics from "./tools/get-client-metrics";
import getTopPerformers from "./tools/get-top-performers";
import listRecentLeads from "./tools/list-recent-leads";

// The OAuth issuer must be the direct Supabase host (not the Cloud proxy).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "hpa-reporting-mcp",
  title: "HPA Reporting",
  version: "0.1.0",
  instructions:
    "Tools for the HPA Reporting workspace. Read clients, aggregated source metrics, top-performing Meta campaigns/ads, and recent leads. All calls execute as the signed-in user under Row-Level Security.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listClients, getClientMetrics, getTopPerformers, listRecentLeads],
});