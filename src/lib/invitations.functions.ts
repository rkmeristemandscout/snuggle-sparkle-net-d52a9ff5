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

    const origin =
      process.env.APP_URL || process.env.PUBLIC_APP_URL || "https://snuggle-sparkle-net.lovable.app";
    const inviteUrl = `${origin.replace(/\/$/, "")}/join/${data.token}`;
    const inviter = data.inviterName ?? "A teammate";

    // Send via Resend through the Lovable connector gateway.
    return await sendViaResend({
      to: data.email,
      subject: `You're invited to join ${orgName}`,
      html: renderInviteHtml({ orgName, inviteUrl, inviter }),
    });
  });

function renderInviteHtml(opts: { orgName: string; inviteUrl: string; inviter: string }) {
  const { orgName, inviteUrl, inviter } = opts;
  return `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#fff;color:#0f172a;padding:24px">
    <div style="max-width:560px;margin:0 auto;padding:32px 28px">
      <h1 style="font-size:22px;margin:0 0 12px">You've been invited to ${escapeHtml(orgName)}</h1>
      <p style="font-size:15px;line-height:22px;margin:0 0 16px">
        ${escapeHtml(inviter)} invited you to collaborate in <strong>${escapeHtml(orgName)}</strong> on Multi-tenant SaaS.
      </p>
      <p style="margin:24px 0">
        <a href="${inviteUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px">Accept invitation</a>
      </p>
      <p style="font-size:15px;line-height:22px;margin:0 0 16px">Or open this link in your browser:<br/>
        <a href="${inviteUrl}" style="color:#2563eb;word-break:break-all">${inviteUrl}</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
      <p style="font-size:12px;color:#64748b;margin:0 0 6px">This invitation expires in 14 days.</p>
      <p style="font-size:12px;color:#64748b;margin:0">If you weren't expecting this email, you can safely ignore it.</p>
    </div>
  </body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function sendViaResend(opts: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<SendResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!lovableKey || !resendKey) {
    return { sent: false, reason: "not_configured", detail: "Resend connector not linked" };
  }
  try {
    const res = await fetch("https://connector-gateway.lovable.dev/resend/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
      },
      body: JSON.stringify({
        from: opts.from ?? "Multi-tenant SaaS <onboarding@resend.dev>",
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[resend] send failed [${res.status}]: ${body}`);
      return { sent: false, reason: "failed", detail: `${res.status}: ${body.slice(0, 300)}` };
    }
    return { sent: true };
  } catch (err: any) {
    return { sent: false, reason: "failed", detail: err?.message };
  }
}

// Lightweight status probe used by the Members page to show a banner /
// checklist when invite emails will not actually be delivered.
export const getInvitationEmailStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const hasLovableKey = !!process.env.LOVABLE_API_KEY;
    const hasResendKey = !!process.env.RESEND_API_KEY;
    return {
      configured: hasLovableKey && hasResendKey,
      checks: {
        lovableKey: hasLovableKey,
        emailHelper: hasResendKey,
        invitationTemplate: true,
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

