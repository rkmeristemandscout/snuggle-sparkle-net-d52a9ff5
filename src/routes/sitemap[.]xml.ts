import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://snuggle-sparkle-net.lovable.app";

interface SitemapEntry {
  path: string;
  lastmod: string; // ISO date — reflects the last time this page's content changed
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

/**
 * Canonical, indexable public routes only.
 *
 * Excluded (by policy):
 *   - /auth, /auth/*         → authentication surfaces (noindex)
 *   - /_authenticated/*      → private app routes (behind auth gate)
 *   - /join/$token, /reset   → single-use / redirect flows
 *   - /api/*                 → server endpoints
 *   - /not-found, /*         → 404 & splat
 *
 * `lastmod` reflects the last real content update for that page — not the
 * deploy timestamp. Bump the ISO string here when you meaningfully change
 * the corresponding page's content.
 */
const ENTRIES: SitemapEntry[] = [
  { path: "/", lastmod: "2026-07-20", changefreq: "weekly", priority: "1.0" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const urls = ENTRIES.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            `    <lastmod>${e.lastmod}</lastmod>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        ).join("\n");

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
