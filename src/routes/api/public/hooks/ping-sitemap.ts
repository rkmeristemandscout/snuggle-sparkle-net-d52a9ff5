import { createFileRoute } from "@tanstack/react-router";

/**
 * Pings search engines with the sitemap URL so they re-crawl after a deployment.
 *
 * Google auto-discovers the sitemap from robots.txt (their ping endpoint was
 * deprecated in June 2023), but we still hit it — it's harmless and returns 200.
 * Bing/Yandex use IndexNow for near-instant discovery.
 *
 * Call this after every successful deploy. It's also scheduled daily via pg_cron
 * as a safety net.
 */
const SITEMAP_URL = "https://snuggle-sparkle-net.lovable.app/sitemap.xml";

export const Route = createFileRoute("/api/public/hooks/ping-sitemap")({
  server: {
    handlers: {
      POST: async () => {
        const results: Record<string, { ok: boolean; status?: number; error?: string }> = {};

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

        return Response.json({
          success: true,
          sitemap: SITEMAP_URL,
          pinged_at: new Date().toISOString(),
          results,
        });
      },
      GET: async () => {
        return Response.json({
          message: "POST to this endpoint to ping search engines with the sitemap.",
          sitemap: SITEMAP_URL,
        });
      },
    },
  },
});
