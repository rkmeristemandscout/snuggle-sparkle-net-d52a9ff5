// Dev-only startup validation: checks whether the current browser origin is
// present in a locally-configured allow-list of expected Supabase Auth
// redirect URLs. If not, logs a clear developer warning and shows a toast
// with the exact URLs to add in Supabase → Authentication → URL Configuration.
//
// This does NOT modify Supabase. It only reads env + window.location to help
// developers spot misconfiguration (e.g. new Vercel/preview domain).
//
// Configure via VITE_SUPABASE_ALLOWED_ORIGINS (comma-separated absolute URLs).
// Example: VITE_SUPABASE_ALLOWED_ORIGINS="https://snuggle-sparkle-net.lovable.app,https://grant-file-share-main.vercel.app"

import { toast } from "sonner";

const STORAGE_KEY = "stackly.authOriginWarning.dismissed";

function normalize(url: string): string {
  try {
    return new URL(url.trim()).origin.toLowerCase();
  } catch {
    return url.trim().replace(/\/+$/, "").toLowerCase();
  }
}

export function validateAuthOrigin(): void {
  if (typeof window === "undefined") return;

  const raw = import.meta.env.VITE_SUPABASE_ALLOWED_ORIGINS as string | undefined;
  const currentOrigin = window.location.origin;
  const currentNorm = normalize(currentOrigin);

  // Always allow localhost dev without warning noise
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(currentOrigin)) return;

  const configured = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (configured.length === 0) {
    // No allow-list configured — skip silently in prod builds, warn in dev.
    if (import.meta.env.DEV) {
      console.info(
        "[auth-origin-check] VITE_SUPABASE_ALLOWED_ORIGINS is not set. Skipping origin validation.",
      );
    }
    return;
  }

  const allowed = configured.map(normalize);
  if (allowed.includes(currentNorm)) return;

  const suggestions = [currentOrigin, `${currentOrigin}/**`, `${currentOrigin}/auth/callback`];

  console.warn(
    [
      "%c[auth-origin-check] Current origin is NOT in the Supabase Auth redirect allow-list.",
      "%cCurrent origin: " + currentOrigin,
      "Configured allow-list: " + configured.join(", "),
      "",
      "Google sign-in and email confirmations will fail from this origin.",
      "Add these URLs in Supabase → Authentication → URL Configuration → Redirect URLs:",
      ...suggestions.map((u) => "  • " + u),
    ].join("\n"),
    "color:#ef4444;font-weight:bold",
    "color:inherit",
  );

  // Toast once per session per origin
  try {
    const dismissed = window.sessionStorage.getItem(STORAGE_KEY);
    if (dismissed === currentNorm) return;
    window.sessionStorage.setItem(STORAGE_KEY, currentNorm);
  } catch {
    // sessionStorage unavailable — still show the toast
  }

  toast.warning("Auth origin not configured", {
    duration: 12000,
    description: `Add "${currentOrigin}" to Supabase → Authentication → URL Configuration → Redirect URLs. Check the console for the exact URLs.`,
  });
}
