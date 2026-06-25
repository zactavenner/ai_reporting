import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!token) { setStatus("error"); return; }
      const { data, error } = await supabase.functions.invoke("report-unsubscribe", { body: { token } });
      if (error || (data as any)?.error) setStatus("error");
      else { setEmail((data as any)?.email || null); setStatus("ok"); }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF6EE] p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-[#e5e0d3] p-8 text-center" style={{ fontFamily: "Inter, sans-serif" }}>
        <div className="text-xs uppercase tracking-widest text-[#C5A55A]">High Performance Ads</div>
        <h1 className="mt-3 text-2xl text-[#0B2B26]" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
          {status === "loading" ? "Processing…" : status === "ok" ? "Unsubscribed" : "Invalid link"}
        </h1>
        <p className="mt-3 text-sm text-[#6b6358]">
          {status === "ok" && (email ? `${email} will no longer receive performance recaps.` : "You will no longer receive performance recaps.")}
          {status === "error" && "This unsubscribe link is invalid or has expired."}
        </p>
      </div>
    </div>
  );
}