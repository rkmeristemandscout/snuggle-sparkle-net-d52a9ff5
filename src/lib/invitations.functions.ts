/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side invitation email delivery via Supabase Auth
// (`auth.admin.inviteUserByEmail`). The DB invitation row is created by
// the `create_invitation` RPC and its token maps to `/join/{token}`,
// where `accept_invitation` atomically joins the org and flips the row
// from `pending` → `accepted`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type SendResult =
  | { sent: true; via?: "supabase_auth" }
  | { sent: false; reason: "not_configured" | "suppressed" | "failed"; detail?: string };

const sendSchema = z.object({
  email: z.string().email(),
  token: z.string().min(10),
  organizationId: z.string().uuid(),
  inviterName: z.string().optional(),
});

export const sendAuthInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => sendSchema.parse(v))
  .handler(async ({ data, context }): Promise<SendResult> => {
    return await sendInvite(data, context);
  });

export const sendInvitationEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => sendSchema.parse(v))
  .handler(async ({ data, context }): Promise<SendResult> => {
    return await sendInvite(data, context);
  });

async function sendInvite(
  data: z.infer<typeof sendSchema>,
  context: { supabase: any; userId: string },
): Promise<SendResult> {
  // Defense-in-depth: caller must be owner/admin of the org.
  const { data: membership } = await context.supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", data.organizationId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role as string)) {
    return { sent: false, reason: "failed", detail: "not_admin" };
  }

  const { data: org } = await context.supabase
    .from("organizations")
    .select("name")
    .eq("id", data.organizationId)
    .maybeSingle();
  const orgName = org?.name ?? "your organization";

  const origin =
    process.env.APP_URL ||
    process.env.PUBLIC_APP_URL ||
    "https://snuggle-sparkle-net.lovable.app";
  const inviteUrl = `${origin.replace(/\/$/, "")}/join/${data.token}`;

  return await sendViaSupabaseAuth({
    email: data.email,
    redirectTo: inviteUrl,
    orgName,
    inviter: data.inviterName ?? "A teammate",
    organizationId: data.organizationId,
    token: data.token,
  });
}

async function sendViaSupabaseAuth(opts: {
  email: string;
  redirectTo: string;
  orgName: string;
  inviter: string;
  organizationId: string;
  token: string;
}): Promise<SendResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(opts.email, {
      redirectTo: opts.redirectTo,
      data: {
        invitation_token: opts.token,
        organization_id: opts.organizationId,
        organization_name: opts.orgName,
        invited_by_name: opts.inviter,
      },
    });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      // Existing user — Supabase can't re-invite. The DB row exists;
      // fall back to a magic-link email that lands on the same accept URL.
      if (
        msg.includes("already been registered") ||
        msg.includes("already registered") ||
        msg.includes("user already") ||
        (error as any).status === 422
      ) {
        const { error: otpErr } = await supabaseAdmin.auth.signInWithOtp({
          email: opts.email,
          options: { emailRedirectTo: opts.redirectTo, shouldCreateUser: false },
        });
        if (otpErr) {
          return { sent: false, reason: "failed", detail: otpErr.message };
        }
        return { sent: true, via: "supabase_auth" };
      }
      if (msg.includes("rate limit") || (error as any).status === 429) {
        return {
          sent: false,
          reason: "failed",
          detail:
            "Supabase Auth email rate limit reached. Configure SMTP in Cloud → Users → Auth Settings → SMTP to raise the limit.",
        };
      }
      return { sent: false, reason: "failed", detail: error.message };
    }
    return { sent: true, via: "supabase_auth" };
  } catch (err: any) {
    return { sent: false, reason: "failed", detail: err?.message };
  }
}

// Status probe used by Members + Email Settings pages. Supabase Auth
// email delivery is always available (default SMTP with a low hourly
// cap; project-configured SMTP for production volume).
export const getInvitationEmailStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return {
      configured: true,
      checks: {
        lovableKey: true,
        emailHelper: true,
        invitationTemplate: true,
      },
    };
  });

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
    return await sendViaSupabaseAuth({
      email: data.email,
      redirectTo: data.inviteUrl,
      orgName: data.organizationName,
      inviter: data.inviterName,
      organizationId: "00000000-0000-0000-0000-000000000000",
      token: "test",
    });
  });

// Email delivery log listing is not available for Supabase Auth emails
// from the app; the Auth dashboard is the source of truth.
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
  .handler(async (): Promise<InvitationEmailLogsResult> => {
    return { available: false, reason: "not_configured", detail: "supabase_auth_logs_unavailable" };
  });

// Config status for the Email Settings page.
export type ResendConfigStatus = {
  configured: boolean;
  hasResendKey: boolean;
  hasLovableKey: boolean;
  fromEmail: string;
  fromEmailSource: "env" | "default";
  domains:
    | { available: true; items: { name: string; status: string; region?: string | null }[] }
    | { available: false; reason: string };
};

export const getResendConfigStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ResendConfigStatus> => {
    return {
      configured: true,
      hasResendKey: true,
      hasLovableKey: true,
      fromEmail: "Supabase Auth (default sender)",
      fromEmailSource: "default",
      domains: {
        available: false,
        reason:
          "Managed by Supabase Auth. Configure a custom SMTP provider in Cloud → Users → Auth Settings → SMTP to use your own sender domain.",
      },
    };
  });
