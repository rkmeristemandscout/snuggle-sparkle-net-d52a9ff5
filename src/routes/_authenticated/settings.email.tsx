import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Mail, RefreshCw, Copy, ExternalLink } from "lucide-react";
import { getResendConfigStatus, sendTestInvitationEmail } from "@/lib/invitations.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/email")({
  component: EmailSettingsPage,
  head: () => ({
    meta: [{ title: "Email Settings — Multi-tenant SaaS" }],
  }),
});

function EmailSettingsPage() {
  const getStatus = useServerFn(getResendConfigStatus);
  const sendTest = useServerFn(sendTestInvitationEmail);
  const [testEmail, setTestEmail] = useState("");
  const [sending, setSending] = useState(false);

  const status = useQuery({
    queryKey: ["resend-config-status"],
    queryFn: () => getStatus(),
  });

  const s = status.data;
  const configured = !!s?.configured;
  const verifiedDomain =
    s?.domains.available && s.domains.items.some((d) => d.status === "verified");

  const copy = async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error("Clipboard blocked");
    }
  };

  const runTest = async () => {
    if (!testEmail) return;
    setSending(true);
    try {
      const origin = window.location.origin;
      const res = await sendTest({
        data: {
          email: testEmail,
          organizationName: "Multi-tenant SaaS",
          inviterName: "Email Settings",
          inviteUrl: `${origin}/join/test-token-preview`,
        },
      });
      if (res.sent) {
        toast.success("Test email sent via Resend", { description: testEmail });
      } else {
        toast.error(`Test failed: ${res.reason}`, { description: res.detail });
      }
    } catch (e: any) {
      toast.error("Test failed", { description: e?.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-1">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Mail className="h-6 w-6" /> Email Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure the Resend integration used to deliver invitation emails.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => status.refetch()}
          disabled={status.isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${status.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      {/* Overall status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Configuration status
            {configured && verifiedDomain ? (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">Ready</Badge>
            ) : configured ? (
              <Badge className="bg-amber-500 hover:bg-amber-500">Needs verified domain</Badge>
            ) : (
              <Badge variant="destructive">Not configured</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Invitations are delivered through Resend via the Lovable connector gateway.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusRow
            ok={!!s?.hasLovableKey}
            label="Lovable connector gateway key"
            hint="Auto-provisioned by Lovable Cloud."
          />
          <StatusRow
            ok={!!s?.hasResendKey}
            label="RESEND_API_KEY"
            hint="Provided by the Resend connector."
          />
          <StatusRow
            ok={!!s && s.fromEmailSource === "env"}
            warn={!!s && s.fromEmailSource === "default"}
            label="RESEND_FROM_EMAIL"
            hint={
              s?.fromEmailSource === "env"
                ? "Set from environment."
                : "Not set — falling back to onboarding@resend.dev (delivers only to your own Resend account email)."
            }
          />
          <StatusRow
            ok={!!verifiedDomain}
            warn={s?.domains.available && !verifiedDomain}
            label="Verified sender domain in Resend"
            hint={
              s?.domains.available
                ? verifiedDomain
                  ? "At least one verified domain is available."
                  : "No verified domain found — add and verify one at resend.com/domains."
                : "Unable to query Resend for domains yet."
            }
          />
        </CardContent>
      </Card>

      {/* Configuration form */}
      <Card>
        <CardHeader>
          <CardTitle>Resend credentials</CardTitle>
          <CardDescription>
            These values are stored as server-side secrets. Update them via the assistant or the
            backend secrets panel — they cannot be edited directly from the browser for security
            reasons.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="resend-key">RESEND_API_KEY</Label>
            <div className="flex gap-2">
              <Input
                id="resend-key"
                readOnly
                value={s?.hasResendKey ? "•••••••••••••••••• (configured)" : "Not set"}
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copy("RESEND_API_KEY", "Secret name copied")}
                title="Copy secret name"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get an API key at{" "}
              <a
                href="https://resend.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline inline-flex items-center gap-1"
              >
                resend.com/api-keys <ExternalLink className="h-3 w-3" />
              </a>
              .
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="from-email">From email address (RESEND_FROM_EMAIL)</Label>
            <div className="flex gap-2">
              <Input
                id="from-email"
                readOnly
                value={s?.fromEmail ?? ""}
                placeholder="Invites <invites@yourdomain.com>"
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copy("RESEND_FROM_EMAIL", "Secret name copied")}
                title="Copy secret name"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Format: <code>Display Name &lt;address@yourdomain.com&gt;</code>. The domain must be
              verified in Resend or delivery will fail.
            </p>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Verified sender domain required</p>
                <p className="mt-1 text-xs">
                  Resend only delivers to arbitrary recipients when you send from a domain you have
                  verified at{" "}
                  <a
                    href="https://resend.com/domains"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    resend.com/domains
                  </a>
                  . Using <code>onboarding@resend.dev</code> works for testing but only delivers to
                  your own Resend account's email.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Verified domains */}
      {s?.domains.available && (
        <Card>
          <CardHeader>
            <CardTitle>Verified domains</CardTitle>
            <CardDescription>Domains currently registered in your Resend account.</CardDescription>
          </CardHeader>
          <CardContent>
            {s.domains.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No domains registered yet. Add one at resend.com/domains.
              </p>
            ) : (
              <ul className="divide-y">
                {s.domains.items.map((d) => (
                  <li key={d.name} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono">{d.name}</span>
                    <Badge
                      variant={d.status === "verified" ? "default" : "secondary"}
                      className={d.status === "verified" ? "bg-emerald-600 hover:bg-emerald-600" : ""}
                    >
                      {d.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* Test send */}
      <Card>
        <CardHeader>
          <CardTitle>Send a test email</CardTitle>
          <CardDescription>
            Delivers the invitation template to the address below using the current Resend
            configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            type="email"
            placeholder="you@example.com"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            disabled={!configured || sending}
          />
          <Button onClick={runTest} disabled={!configured || !testEmail || sending}>
            {sending ? "Sending…" : "Send test"}
          </Button>
        </CardContent>
        {!configured && (
          <CardContent className="pt-0 text-xs text-muted-foreground">
            Configure the Resend API key before sending a test.
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function StatusRow({
  ok,
  warn,
  label,
  hint,
}: {
  ok?: boolean;
  warn?: boolean;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
      ) : warn ? (
        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
      ) : (
        <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
      )}
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}
