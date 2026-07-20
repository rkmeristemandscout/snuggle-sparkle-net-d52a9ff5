import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

/**
 * Pings search engines with the sitemap URL so they re-crawl after a deployment.
 *
 * Secured with `x-sitemap-ping-secret` header (SITEMAP_PING_SECRET env var).
 * Rate-limited to 1 successful ping per 5 minutes (in-memory, per-worker).
 * Repeated calls within the window return the cached last result (idempotent).
 */
const SITEMAP_URL = "https://snuggle-sparkle-net.lovable.app/sitemap.xml";
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between real pings

type PingResult = {
  success: true;
  sitemap: string;
  pinged_at: string;
  cached: boolean;
  results: Record<string, { ok: boolean; status?: number; error?: string }>;
};

// Module-scoped cache — per Worker instance. Prevents burst-flooding upstreams.
let lastPing: { at: number; payload: PingResult } | null = null;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Accepts either:
 *   1. `x-sitemap-ping-secret` matching SITEMAP_PING_SECRET (for manual / CI use), or
 *   2. `apikey` matching SUPABASE_PUBLISHABLE_KEY (used by the pg_cron schedule).
 * Rejects everything else with 401.
 */
function authorize(request: Request): Response | null {
  const secret = process.env.SITEMAP_PING_SECRET;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;

  const providedSecret = request.headers.get("x-sitemap-ping-secret");
  const providedApiKey = request.headers.get("apikey");

  const secretOk = !!secret && !!providedSecret && safeEqual(providedSecret, secret);
  const apiKeyOk = !!anon && !!providedApiKey && safeEqual(providedApiKey, anon);

  if (!secretOk && !apiKeyOk) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export const Route = createFileRoute("/api/public/hooks/ping-sitemap")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = authorize(request);
        if (unauthorized) return unauthorized;

        const now = Date.now();
        if (lastPing && now - lastPing.at < MIN_INTERVAL_MS) {
          return Response.json(
            { ...lastPing.payload, cached: true },
            { headers: { "Retry-After": String(Math.ceil((MIN_INTERVAL_MS - (now - lastPing.at)) / 1000)) } },
          );
        }

        const results: PingResult["results"] = {};
        const targets: Array<[string, string]> = [
          ["google", `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`],
          ["bing", `https://www.bing.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`],
        ];

        await Promise.all(
          targets.map(async ([name, url]) => {
            try {
              const res = await fetch(url, { method: "GET" });
              results[name] = { ok: res.ok, status: res.status };
            } catch (err) {
              results[name] = { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
          }),
        );

        const payload: PingResult = {
          success: true,
          sitemap: SITEMAP_URL,
          pinged_at: new Date().toISOString(),
          cached: false,
          results,
        };
        lastPing = { at: now, payload };
        return Response.json(payload);
      },
      GET: async ({ request }) => {
        const unauthorized = authorize(request);
        if (unauthorized) return unauthorized;
        return Response.json({
          message: "POST to this endpoint (with x-sitemap-ping-secret header) to ping search engines.",
          sitemap: SITEMAP_URL,
          last_ping: lastPing ? lastPing.payload.pinged_at : null,
          min_interval_seconds: MIN_INTERVAL_MS / 1000,
        });
      },
    },
  },
});
