// Organization invitation email template.
//
// This file is the source of truth for the "organization-invitation"
// template used by sendTemplateEmail. It is written to be *inert* until
// the transactional email infrastructure is scaffolded (email domain
// configured + @react-email/components installed). Once scaffolded:
//
//   1. `@react-email/components` becomes available, and this file's
//      React Email component renders to real HTML.
//   2. Register in `src/lib/email-templates/registry.ts`:
//         import { template as organizationInvitation } from "./organization-invitation";
//         export const TEMPLATES = { "organization-invitation": organizationInvitation, ... };
//
// Until then, `sendInvitationEmail` returns { sent: false, reason: 'not_configured' }.

import * as React from "react";

// Loose type so this file compiles before `./registry` is scaffolded.
type TemplateEntry = {
  component: React.ComponentType<any>;
  subject: string | ((props: any) => string);
  displayName?: string;
  previewData?: Record<string, unknown>;
};

export interface OrganizationInvitationProps {
  organizationName: string;
  inviteUrl: string;
  inviterName?: string;
}

// React Email components are optional at build time — resolve them if
// installed, otherwise fall back to plain intrinsic elements so the file
// still compiles and previews structurally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RE: any = {};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  RE = require("@react-email/components");
} catch {
  RE = {};
}
const Html = RE.Html ?? ((p: any) => <html {...p} />);
const Head = RE.Head ?? ((p: any) => <head {...p} />);
const Body = RE.Body ?? ((p: any) => <body {...p} />);
const Container = RE.Container ?? ((p: any) => <div {...p} />);
const Heading = RE.Heading ?? ((p: any) => <h1 {...p} />);
const Text = RE.Text ?? ((p: any) => <p {...p} />);
const Button = RE.Button ?? ((p: any) => <a {...p} />);
const Preview = RE.Preview ?? ((p: any) => <span {...p} />);
const Section = RE.Section ?? ((p: any) => <section {...p} />);
const Hr = RE.Hr ?? ((p: any) => <hr {...p} />);
const Link = RE.Link ?? ((p: any) => <a {...p} />);

const main = {
  backgroundColor: "#ffffff",
  fontFamily: "Inter, Arial, sans-serif",
  color: "#0f172a",
};
const container = { padding: "32px 28px", maxWidth: 560, margin: "0 auto" };
const h1 = { fontSize: "22px", fontWeight: 600, margin: "0 0 12px" };
const p = { fontSize: "15px", lineHeight: "22px", margin: "0 0 16px" };
const btn = {
  display: "inline-block",
  background: "#0f172a",
  color: "#ffffff",
  textDecoration: "none",
  padding: "12px 20px",
  borderRadius: "8px",
  fontWeight: 600,
  fontSize: "14px",
};
const hr = { border: "none", borderTop: "1px solid #e2e8f0", margin: "24px 0" };
const muted = { fontSize: "12px", lineHeight: "18px", color: "#64748b", margin: "0 0 6px" };

function Email({ organizationName, inviteUrl, inviterName }: OrganizationInvitationProps) {
  const invitedBy = inviterName?.trim() || "A teammate";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${invitedBy} invited you to join ${organizationName}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>You&apos;ve been invited to {organizationName}</Heading>
          <Text style={p}>
            {invitedBy} invited you to collaborate in <strong>{organizationName}</strong> on
            Multi-tenant SaaS. Accept the invitation to get access to your workspace.
          </Text>
          <Section style={{ margin: "24px 0" }}>
            <Button href={inviteUrl} style={btn}>
              Accept invitation
            </Button>
          </Section>
          <Text style={p}>
            Or open this link in your browser:
            <br />
            <Link href={inviteUrl} style={{ color: "#2563eb", wordBreak: "break-all" }}>
              {inviteUrl}
            </Link>
          </Text>
          <Hr style={hr} />
          <Text style={muted}>This invitation expires in 14 days.</Text>
          <Text style={muted}>
            If you weren&apos;t expecting this email, you can safely ignore it — no account will be
            created.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const template: TemplateEntry = {
  component: Email,
  subject: (props: OrganizationInvitationProps) =>
    `You're invited to join ${props.organizationName}`,
  displayName: "Organization invitation",
  previewData: {
    organizationName: "Acme Inc.",
    inviteUrl: "https://example.com/join/preview-token",
    inviterName: "Jane Doe",
  },
};

export default template;
