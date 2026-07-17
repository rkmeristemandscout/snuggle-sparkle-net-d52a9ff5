/**
 * E2E tests hitting the running dev server's server functions.
 * Verifies tenant-aware CRUD for teams and departments across tenants.
 * Run: bun run scripts/teams-e2e.ts   (requires dev server on :8080)
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
const BASE = process.env.E2E_BASE_URL || "http://localhost:8080";
if (!URL || !SERVICE || !ANON) { console.error("Missing env"); process.exit(1); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const tag = Math.random().toString(36).slice(2, 8);
const passA = "Zx9qL#mK2vP@nR7wQ4A", passB = "Ap4uV#nM8jK@qL2xR6B", passC = "Wq3pE#rT7yU@iO2sD9C";
const eA = `e2e-a-${tag}@ex.test`, eB = `e2e-b-${tag}@ex.test`, eC = `e2e-c-${tag}@ex.test`;

let failures = 0;
function expect(name: string, ok: boolean, msg?: string) {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${msg ? ` — ${msg}` : ""}`);
}

async function mkUser(email: string, password: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  return data.user!.id;
}
async function tokenFor(email: string, password: string) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { token: data.session!.access_token, client: c };
}

async function callFn(name: string, token: string | null, data: unknown, method: "GET" | "POST" = "POST") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const url = method === "GET"
    ? `${BASE}/_serverFn/${name}?payload=${encodeURIComponent(JSON.stringify({ data }))}`
    : `${BASE}/_serverFn/${name}`;
  const res = await fetch(url, {
    method, headers,
    body: method === "POST" ? JSON.stringify({ data }) : undefined,
  });
  const text = await res.text();
  let body: unknown; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function main() {
  const idA = await mkUser(eA, passA);
  const idB = await mkUser(eB, passB);
  const idC = await mkUser(eC, passC);
  const A = await tokenFor(eA, passA);
  const B = await tokenFor(eB, passB);
  const C = await tokenFor(eC, passC);

  const orgA = (await A.client.rpc("create_organization", { _name: `E2E-A ${tag}`, _slug: `e2e-a-${tag}`, _description: "" })).data as { id: string };
  const orgB = (await C.client.rpc("create_organization", { _name: `E2E-B ${tag}`, _slug: `e2e-b-${tag}`, _description: "" })).data as { id: string };

  // add B into orgA as plain member
  const inv = await A.client.from("organization_invitations").insert({
    organization_id: orgA.id, email: eB, role: "member", invited_by: idA,
  }).select("token").single();
  await B.client.rpc("accept_invitation", { _token: inv.data!.token });

  try {
    // --- Server fns require auth ---
    const noAuth = await callFn("src_lib_teams_functions_ts--createTeam", null, {
      organizationId: orgA.id, name: "X", slug: `nope-${tag}`, description: "",
    });
    expect("Unauth call rejected", noAuth.status === 401 || noAuth.status === 500);

    // --- Zod validation rejects bad slug ---
    const badSlug = await callFn("src_lib_teams_functions_ts--createTeam", A.token, {
      organizationId: orgA.id, name: "Bad Team", slug: "Bad Slug!!", description: "",
    });
    expect("Bad slug rejected by server-side Zod", badSlug.status >= 400,
      `status ${badSlug.status}`);

    // --- Owner creates team via server fn ---
    const create = await callFn("src_lib_teams_functions_ts--createTeam", A.token, {
      organizationId: orgA.id, name: "Alpha", slug: `alpha-${tag}`, description: "team A",
    });
    expect("Owner creates team via server fn", create.status === 200,
      `status ${create.status} body ${JSON.stringify(create.body).slice(0, 120)}`);
    const teamId = (create.body as { result: { id: string } })?.result?.id;

    // --- Cross-tenant: C (outsider) cannot create team in orgA ---
    const cross = await callFn("src_lib_teams_functions_ts--createTeam", C.token, {
      organizationId: orgA.id, name: "Bad", slug: `bad-${tag}`, description: "",
    });
    expect("Outsider cannot create team in another org", cross.status >= 400 || (cross.body as any)?.error);

    // --- Cross-tenant list: C cannot see teams of orgA ---
    const cList = await callFn("src_lib_teams_functions_ts--listTeams", C.token,
      { organizationId: orgA.id }, "GET");
    const cRows = (cList.body as { result?: unknown[] })?.result ?? [];
    expect("Outsider list returns empty for other org", Array.isArray(cRows) && cRows.length === 0);

    // --- Owner can list ---
    const aList = await callFn("src_lib_teams_functions_ts--listTeams", A.token,
      { organizationId: orgA.id }, "GET");
    const aRows = (aList.body as { result?: unknown[] })?.result ?? [];
    expect("Owner list includes team", Array.isArray(aRows) && aRows.length >= 1);

    // --- Non-admin member cannot update team (owned by A) ---
    if (teamId) {
      const bUpd = await callFn("src_lib_teams_functions_ts--updateTeam", B.token,
        { teamId, description: "hacked" });
      expect("Non-manager cannot update team", bUpd.status >= 400 || (bUpd.body as any)?.error);

      // Owner update OK
      const aUpd = await callFn("src_lib_teams_functions_ts--updateTeam", A.token,
        { teamId, description: "updated" });
      expect("Owner updates team", aUpd.status === 200);

      // --- Team member: A adds B ---
      const addB = await callFn("src_lib_teams_functions_ts--addTeamMember", A.token,
        { teamId, userId: idB, role: "member" });
      expect("Owner adds team member", addB.status === 200,
        `body ${JSON.stringify(addB.body).slice(0, 120)}`);

      // Cross-tenant: C cannot add themselves
      const cAdd = await callFn("src_lib_teams_functions_ts--addTeamMember", C.token,
        { teamId, userId: idC, role: "member" });
      expect("Outsider cannot add team member", cAdd.status >= 400 || (cAdd.body as any)?.error);

      // Remove
      const rem = await callFn("src_lib_teams_functions_ts--removeTeamMember", A.token,
        { teamId, userId: idB });
      expect("Owner removes team member", rem.status === 200);

      // Delete team
      const del = await callFn("src_lib_teams_functions_ts--deleteTeam", A.token, { teamId });
      expect("Owner deletes team", del.status === 200);
    }

    // ==== DEPARTMENTS ====
    // Zod: min length name
    const shortName = await callFn("src_lib_departments_functions_ts--createDepartment", A.token,
      { organizationId: orgA.id, name: "A", slug: `x-${tag}`, description: "" });
    expect("Short name rejected", shortName.status >= 400);

    const dep = await callFn("src_lib_departments_functions_ts--createDepartment", A.token,
      { organizationId: orgA.id, name: "Ops", slug: `ops-${tag}`, description: "" });
    expect("Owner creates department", dep.status === 200,
      `body ${JSON.stringify(dep.body).slice(0, 120)}`);
    const depId = (dep.body as { result: { id: string } })?.result?.id;

    // Cross-tenant: C cannot create department in orgA
    const cDep = await callFn("src_lib_departments_functions_ts--createDepartment", C.token,
      { organizationId: orgA.id, name: "Bad", slug: `bad-d-${tag}`, description: "" });
    expect("Outsider cannot create department", cDep.status >= 400 || (cDep.body as any)?.error);

    // Cross-tenant list empty
    const cDepList = await callFn("src_lib_departments_functions_ts--listDepartments", C.token,
      { organizationId: orgA.id }, "GET");
    const cDepRows = (cDepList.body as { result?: unknown[] })?.result ?? [];
    expect("Outsider dept list empty for other org", Array.isArray(cDepRows) && cDepRows.length === 0);

    // Member cannot update
    if (depId) {
      const bUpd = await callFn("src_lib_departments_functions_ts--updateDepartment", B.token,
        { departmentId: depId, description: "hacked" });
      expect("Plain member cannot update department", bUpd.status >= 400 || (bUpd.body as any)?.error);

      const aUpd = await callFn("src_lib_departments_functions_ts--updateDepartment", A.token,
        { departmentId: depId, description: "ok" });
      expect("Owner updates department", aUpd.status === 200);

      const del = await callFn("src_lib_departments_functions_ts--deleteDepartment", A.token,
        { departmentId: depId });
      expect("Owner deletes department", del.status === 200);
    }
  } finally {
    for (const id of [orgA?.id, orgB?.id].filter(Boolean)) await admin.from("organizations").delete().eq("id", id);
    for (const id of [idA, idB, idC]) await admin.auth.admin.deleteUser(id);
  }

  console.log(`\nfailures: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
