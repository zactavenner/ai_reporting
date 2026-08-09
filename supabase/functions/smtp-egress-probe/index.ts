// Diagnostic: is outbound SMTP egress allowed from the edge runtime?
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

async function probe(kind: 'tls' | 'tcp', hostname: string, port: number, readGreeting: boolean) {
  const t0 = Date.now();
  try {
    const conn = await Promise.race([
      kind === 'tls' ? Deno.connectTls({ hostname, port }) : Deno.connect({ hostname, port }),
      new Promise<never>((_, r) => setTimeout(() => r(new Error('connect timeout (10s)')), 10_000)),
    ]) as Deno.Conn;
    const connectedMs = Date.now() - t0;
    let greeting: string | null = null;
    if (readGreeting) {
      const buf = new Uint8Array(256);
      const n = await Promise.race([
        conn.read(buf),
        new Promise<never>((_, r) => setTimeout(() => r(new Error('read timeout (10s)')), 10_000)),
      ]) as number | null;
      greeting = n ? new TextDecoder().decode(buf.subarray(0, n)).trim() : '(eof)';
    }
    try { conn.close(); } catch { /* ignore */ }
    return { target: `${hostname}:${port}`, kind, ok: true, connectedMs, totalMs: Date.now() - t0, greeting };
  } catch (e) {
    return { target: `${hostname}:${port}`, kind, ok: false, totalMs: Date.now() - t0, error: String((e as Error).message) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  if (body?.password !== 'HPA1234$') return new Response('unauthorized', { status: 401, headers: cors });
  const results = [
    await probe('tls', 'smtp.gmail.com', 465, true),
    await probe('tcp', 'smtp.gmail.com', 587, true),
    await probe('tcp', 'smtp.gmail.com', 25, true),
    await probe('tls', 'api.resend.com', 443, false), // control: non-SMTP port
  ];
  return new Response(JSON.stringify({ results }, null, 2), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
