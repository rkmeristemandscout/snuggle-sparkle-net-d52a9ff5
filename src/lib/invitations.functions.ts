// Server-side invitation email delivery.
// Gracefully returns { sent: false, reason: 'not_configured' } when no
// email domain / transactional template registry exists yet, so the
// client flow keeps working (invite row is created + link copied).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sendSchema = z.object({
  email: z.string().email(),
  token: z.string().min(10),
  organizationId: z.string().uuid(),
  inviterName: z.string().optional(),
});

type SendResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "suppressed" | "failed"; detail?: string };

export const sendInvitationEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => sendSchema.parse(v))
  .handler(async ({ data, context }): Promise<SendResult> => {
    // Lookup org name for the email body (RLS: caller must be a member).
    const { data: org } = await context.supabase
      .from("organizations")
      .select("name")
      .eq("id", data.organizationId)
      .maybeSingle();
    const orgName = org?.name ?? "your organization";

    const origin = process.env.APP_URL || process.env.PUBLIC_APP_URL || "";
    const inviteUrl = `${origin.replace(/\/$/, "")}/join/${data.token}`;

    // Try to use the scaffolded transactional email helper. If it isn't
    // scaffolded yet (no email domain configured), fall back gracefully.
    try {
      // Dynamic + computed path so TS doesn't require the module to exist
      // until the transactional email templates are scaffolded.
      const modPath = "@/lib/email-templates/send-email";
      const mod: any = await import(/* @vite-ignore */ modPath).catch(() => null);
      if (!mod?.sendTemplateEmail) {
        return { sent: false, reason: "not_configured" };
      }
      const result = await mod.sendTemplateEmail("organization-invitation", data.email, {
        templateData: {
          organizationName: orgName,
          inviteUrl,
          inviterName: data.inviterName ?? "A teammate",
        },
        idempotencyKey: `org-invite-${data.token}`,
      });
      if (result?.sent) return { sent: true };
      if (result?.reason === "recipient_suppressed") return { sent: false, reason: "suppressed" };
      return { sent: false, reason: "failed" };
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code === "domain_not_verified" || code === "emails_disabled") {
        return { sent: false, reason: "not_configured", detail: code };
      }
      return { sent: false, reason: "failed", detail: err?.message };
    }
  });
