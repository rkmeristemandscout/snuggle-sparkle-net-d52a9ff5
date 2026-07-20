import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/share/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token;
        if (!token || token.length < 16) return new Response("Not found", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: share, error } = await supabaseAdmin
          .from("project_file_shares")
          .select("id, expires_at, revoked_at, file_id")
          .eq("token", token)
          .maybeSingle();
        if (error || !share) return new Response("Link not found", { status: 404 });
        if (share.revoked_at) return new Response("This share link was revoked.", { status: 410 });
        if (new Date(share.expires_at).getTime() < Date.now())
          return new Response("This share link has expired.", { status: 410 });

        const { data: file, error: fe } = await supabaseAdmin
          .from("project_files")
          .select("storage_path, file_name")
          .eq("id", share.file_id)
          .maybeSingle();
        if (fe || !file) return new Response("File not found", { status: 404 });

        const remaining = Math.max(
          60,
          Math.min(3600, Math.floor((new Date(share.expires_at).getTime() - Date.now()) / 1000)),
        );
        const { data: sig, error: se } = await supabaseAdmin.storage
          .from("project-files")
          .createSignedUrl(file.storage_path, remaining, { download: file.file_name });
        if (se || !sig) return new Response("Could not sign URL", { status: 500 });

        return new Response(null, {
          status: 302,
          headers: { Location: sig.signedUrl, "Cache-Control": "no-store" },
        });
      },
    },
  },
});
