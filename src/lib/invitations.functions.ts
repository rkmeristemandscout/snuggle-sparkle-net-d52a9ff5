/* eslint-disable @typescript-eslint/no-explicit-any */
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

// Lightweight status probe used by the Members page to show a banner /
// checklist when invite emails will not actually be delivered.
export const getInvitationEmailStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const hasLovableKey = !!process.env.LOVABLE_API_KEY;
    let hasHelper = false;
    let hasTemplate = false;
    try {
      const modPath = "@/lib/email-templates/send-email";
      const mod: any = await import(/* @vite-ignore */ modPath).catch(() => null);
      hasHelper = !!mod?.sendTemplateEmail;
      if (hasHelper) {
        const regPath = "@/lib/email-templates/registry";
        const reg: any = await import(/* @vite-ignore */ regPath).catch(() => null);
        const templates = reg?.TEMPLATES ?? reg?.templates ?? {};
        hasTemplate = !!templates["organization-invitation"];
      }
    } catch {
      // ignore — treated as not configured
    }
    return {
      configured: hasLovableKey && hasHelper && hasTemplate,
      checks: {
        lovableKey: hasLovableKey,
        emailHelper: hasHelper,
        invitationTemplate: hasTemplate,
      },
    };
  });

// Send a rendered invitation email to an arbitrary test address so admins
// can verify subject, preview text, and CTA styling in a real inbox before
// inviting a teammate. Uses the same template + helper as real invites.
const testSchema = z.object({
  email: z.string().email(),
  organizationName: z.string().min(1).max(200),
  inviterName: z.string().min(1).max(200),
  inviteUrl: z.string().url(),
});

export const sendTestInvitationEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => testSchema.parse(v))
  .handler(async ({ data }): Promise<SendResult> => {
    try {
      const modPath = "@/lib/email-templates/send-email";
      const mod: any = await import(/* @vite-ignore */ modPath).catch(() => null);
      if (!mod?.sendTemplateEmail) {
        return { sent: false, reason: "not_configured" };
      }
      const result = await mod.sendTemplateEmail("organization-invitation", data.email, {
        templateData: {
          organizationName: data.organizationName,
          inviteUrl: data.inviteUrl,
          inviterName: data.inviterName,
        },
        idempotencyKey: `org-invite-test-${data.email}-${Date.now()}`,
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

// List recent email delivery events for invitations in a given organization.
// Pulls invitation recipient addresses from the DB (RLS-scoped to the caller),
// then queries Lovable's email logs and returns only events for those
// recipients so admins can see sent / bounced / suppressed / rejected /
// rate-limited outcomes for their invites.
const logsSchema = z.object({
  organizationId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).optional(),
});

export type InvitationEmailLog = {
  timestamp: string;
  recipient: string;
  event_type: string;
  status: string | null;
  message_id: string | null;
};

export type InvitationEmailLogsResult =
  | {
      available: true;
      events: InvitationEmailLog[];
      historyStartsAt: string | null;
      recipientCount: number;
    }
  | { available: false; reason: "not_configured" | "failed"; detail?: string };

export const listInvitationEmailLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => logsSchema.parse(v))
  .handler(async ({ data, context }): Promise<InvitationEmailLogsResult> => {
    if (!process.env.LOVABLE_API_KEY) {
      return { available: false, reason: "not_configured" };
    }
    // RLS scopes to invitations the caller can see for this org.
    const { data: invites, error } = await context.supabase
      .from("organization_invitations")
      .select("email")
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return { available: false, reason: "failed", detail: error.message };

    const recipients = new Set(
      (invites ?? []).map((r) => (r.email ?? "").toLowerCase()).filter(Boolean),
    );
    if (recipients.size === 0) {
      return { available: true, events: [], historyStartsAt: null, recipientCount: 0 };
    }

    try {
      const { listEmailLogs } = await import("@lovable.dev/email-js");
      const res = await listEmailLogs(
        { limit: data.limit ?? 100 },
        { apiKey: process.env.LOVABLE_API_KEY! },
      );
      const events: InvitationEmailLog[] = (res.data ?? [])
        .filter((e) => recipients.has((e.recipient ?? "").toLowerCase()))
        .map((e) => ({
          timestamp: e.timestamp,
          recipient: e.recipient,
          event_type: e.event_type,
          status: e.status ?? null,
          message_id: e.message_id ?? null,
        }));
      return {
        available: true,
        events,
        historyStartsAt: res.history_starts_at ?? null,
        recipientCount: recipients.size,
      };
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code === "emails_disabled" || code === "domain_not_verified") {
        return { available: false, reason: "not_configured", detail: code };
      }
      return { available: false, reason: "failed", detail: err?.message };
    }
  });

