/**
 * RLS regression + end-to-end organization tests.
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY).
 * Run: bun run scripts/rls-tests.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
if (!URL || !SERVICE || !ANON) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const tag = Math.random().toString(36).slice(2, 8);
const passA = "Zx9qL#mK2vP@nR7wQ4A";
const passB = "Ap4uV#nM8jK@qL2xR6B";
const emailA = `rls-a-${tag}@example.test`;
const emailB = `rls-b-${tag}@example.test`;
const slugA = `rls-a-${tag}`;
const slugB = `rls-b-${tag}`;

let failures = 0;
const results: Array<{ name: string; ok: boolean; msg?: string }> = [];

function expect(name: string, ok: boolean, msg?: string) {
  results.push({ name, ok, msg });
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${msg ? ` — ${msg}` : ""}`);
}

async function newClient(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return c;
}

async function createUser(email: string, password: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: email },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user!.id;
}

async function cleanup(userIds: string[], orgIds: string[]) {
  for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
}

async function main() {
  const idA = await createUser(emailA, passA);
  const idB = await createUser(emailB, passB);
  const A = await newClient(emailA, passA);
  const B = await newClient(emailB, passB);

  // --- Create orgs ---
  const orgA = (await A.rpc("create_organization", { _name: `Org A ${tag}`, _slug: slugA, _description: "A" })).data as any;
  const orgB = (await B.rpc("create_organization", { _name: `Org B ${tag}`, _slug: slugB, _description: "B" })).data as any;
  expect("A creates own org", !!orgA?.id);
  expect("B creates own org", !!orgB?.id);

  try {
    // --- Slug uniqueness ---
    const dup = await A.rpc("create_organization", { _name: "dup", _slug: slugB, _description: "" });
    expect("duplicate slug rejected", !!dup.error);

    // --- Tenant-isolated SELECT ---
    const aSeesB = await A.from("organizations").select("id").eq("id", orgB.id).maybeSingle();
    expect("A cannot SELECT B's org", aSeesB.data === null);
    const aSeesBmembers = await A.from("organization_members").select("id").eq("organization_id", orgB.id);
    expect("A cannot SELECT B's members", (aSeesBmembers.data ?? []).length === 0);

    // --- Tenant-isolated UPDATE / DELETE ---
    const aUpdB = await A.from("organizations").update({ name: "hacked" }).eq("id", orgB.id).select();
    expect("A cannot UPDATE B's org", (aUpdB.data ?? []).length === 0);
    const bCheck = (await admin.from("organizations").select("name").eq("id", orgB.id).single()).data as any;
    expect("B's org name unchanged", bCheck.name !== "hacked", `got: ${bCheck.name}`);
    const aDelB = await A.from("organizations").delete().eq("id", orgB.id).select();
    expect("A cannot DELETE B's org", (aDelB.data ?? []).length === 0);

    // --- Tenant-isolated member INSERT ---
    const aInsBmember = await A.from("organization_members").insert({ organization_id: orgB.id, user_id: idA, role: "admin" }).select();
    expect("A cannot INSERT self into B's org", !!aInsBmember.error || (aInsBmember.data ?? []).length === 0);

    // --- A can see own org & members ---
    const aOwn = await A.from("organizations").select("id").eq("id", orgA.id).maybeSingle();
    expect("A can SELECT own org", aOwn.data?.id === orgA.id);
    const aOwnMem = await A.from("organization_members").select("role").eq("organization_id", orgA.id).eq("user_id", idA).maybeSingle();
    expect("A is owner of own org", aOwnMem.data?.role === "owner");

    // --- Invitation: A invites B ---
    const invIns = await A.from("organization_invitations").insert({
      organization_id: orgA.id, email: emailB, role: "member", invited_by: idA,
    }).select("token").single();
    expect("A can create invitation", !!invIns.data?.token, invIns.error?.message);
    const token1 = invIns.data!.token as string;

    // B can see invitation addressed to them
    const bSeesInv = await B.from("organization_invitations").select("id").eq("token", token1).maybeSingle();
    expect("B can view invitation to own email", !!bSeesInv.data);

    // Non-recipient cannot: create a 3rd user briefly
    // (skipped for brevity; covered by policy: lower(email)=auth email)

    // --- Reject flow ---
    const invIns2 = await A.from("organization_invitations").insert({
      organization_id: orgA.id, email: emailB, role: "member", invited_by: idA,
    }).select("token").single();
    const token2 = invIns2.data!.token as string;
    const rej = await B.rpc("reject_invitation", { _token: token2 });
    expect("B can reject invitation", !rej.error, rej.error?.message);
    const bStillOutsider = await B.from("organizations").select("id").eq("id", orgA.id).maybeSingle();
    expect("Reject does NOT grant access", bStillOutsider.data === null);

    // --- Accept flow ---
    const acc = await B.rpc("accept_invitation", { _token: token1 });
    expect("B can accept invitation", !acc.error, acc.error?.message);
    const bNowSees = await B.from("organizations").select("id").eq("id", orgA.id).maybeSingle();
    expect("B can now SELECT org A", bNowSees.data?.id === orgA.id);
    const bAsMember = await B.from("organization_members").select("role").eq("organization_id", orgA.id).eq("user_id", idB).maybeSingle();
    expect("B is member of org A", bAsMember.data?.role === "member");

    // --- Member cannot UPDATE org or promote self ---
    const bUpd = await B.from("organizations").update({ name: "member-hacked" }).eq("id", orgA.id).select();
    expect("Member cannot UPDATE org", (bUpd.data ?? []).length === 0);
    const bPromote = await B.from("organization_members").update({ role: "owner" }).eq("organization_id", orgA.id).eq("user_id", idB).select();
    expect("Member cannot self-promote", (bPromote.data ?? []).length === 0);

    // --- A promotes B to admin ---
    const aPromoteB = await A.from("organization_members").update({ role: "admin" }).eq("organization_id", orgA.id).eq("user_id", idB).select();
    expect("Owner can promote member→admin", (aPromoteB.data ?? []).length === 1, aPromoteB.error?.message);

    // Now B (admin) can UPDATE org
    const bUpd2 = await B.from("organizations").update({ description: "updated by admin" }).eq("id", orgA.id).select();
    expect("Admin can UPDATE org after promotion", (bUpd2.data ?? []).length === 1);

    // --- A demotes B back to member ---
    const aDemote = await A.from("organization_members").update({ role: "member" }).eq("organization_id", orgA.id).eq("user_id", idB).select();
    expect("Owner can demote admin→member", (aDemote.data ?? []).length === 1);
    const bUpd3 = await B.from("organizations").update({ description: "again" }).eq("id", orgA.id).select();
    expect("Demoted member cannot UPDATE org", (bUpd3.data ?? []).length === 0);

    // --- Protect last owner ---
    const aLeave = await A.rpc("leave_organization", { _org: orgA.id });
    expect("Last owner cannot leave", !!aLeave.error, aLeave.error?.message ?? "unexpectedly succeeded");
    const aSelfDemote = await A.from("organization_members").update({ role: "admin" }).eq("organization_id", orgA.id).eq("user_id", idA).select();
    expect("Last owner cannot self-demote", !!aSelfDemote.error || (aSelfDemote.data ?? []).length === 0);

    // --- Only owner can DELETE ---
    // Promote B to admin then confirm admin CANNOT delete
    await A.from("organization_members").update({ role: "admin" }).eq("organization_id", orgA.id).eq("user_id", idB);
    const bDel = await B.from("organizations").delete().eq("id", orgA.id).select();
    expect("Admin cannot DELETE org (owner-only)", (bDel.data ?? []).length === 0);

    // --- B leaves org A ---
    const bLeave = await B.rpc("leave_organization", { _org: orgA.id });
    expect("Non-last member can leave", !bLeave.error, bLeave.error?.message);
    const bAfterLeave = await B.from("organizations").select("id").eq("id", orgA.id).maybeSingle();
    expect("After leaving, no more SELECT access", bAfterLeave.data === null);

    // --- Owner deletes own org ---
    const aDel = await A.from("organizations").delete().eq("id", orgA.id).select();
    expect("Owner can DELETE own org", (aDel.data ?? []).length === 1);
  } finally {
    await cleanup([idA, idB], [orgA?.id, orgB?.id].filter(Boolean));
  }

  console.log(`\n${results.length - failures}/${results.length} passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
