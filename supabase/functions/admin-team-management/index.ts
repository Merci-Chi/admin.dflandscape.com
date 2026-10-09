import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ORIGIN = "https://admin.dflandscape.com";
const corsHeaders = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
function normalizeMailbox(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  return email.endsWith("@dflandscape.com") ? email : "";
}
function temporaryPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_";
  const bytes = new Uint8Array(22);
  crypto.getRandomValues(bytes);
  let value = "T";
  for (const byte of bytes) value += chars[byte % chars.length];
  return value + "9!";
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("origin") !== ORIGIN) return respond({ error: "This origin is not allowed." }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return respond({ error: "Team management is not configured." }, 503);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return respond({ error: "Sign in with an authorized admin account." }, 401);

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const caller = authData.user;
    if (authError || !caller) return respond({ error: "Your session is invalid. Sign in again." }, 401);

    const { data: adminRow, error: adminCheckError } = await admin.from("dfl_admins")
      .select("user_id").eq("user_id", caller.id).maybeSingle();
    if (adminCheckError) throw adminCheckError;
    if (!adminRow) return respond({ error: "Only authorized Desert Forest admins can manage the team." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    const { data: membershipRows, error: memberErr } = await admin.from("dflandscape_mail_access")
      .select("user_id,mailbox_email,active,role,created_at").order("created_at", { ascending: true });
    if (memberErr) throw memberErr;
    const membershipById = new Map<string, any[]>();
    for (const row of membershipRows || []) {
      const rows = membershipById.get(row.user_id) || [];
      rows.push(row);
      membershipById.set(row.user_id, rows);
    }
    const activeMailAdmins = new Set((membershipRows || []).filter(row =>
      row.active === true && String(row.role || "").toLowerCase() === "admin"
    ).map(row => row.user_id));

    if (action === "list") {
      const [{ data: userPage, error: usersError }, { data: mailboxRows, error: mailboxError }, { data: permissionRows, error: permissionError }] =
        await Promise.all([
          admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
          admin.from("dflandscape_mailboxes").select("email,active").eq("active", true).order("email"),
          admin.from("dflandscape_mailbox_permissions").select("user_id,mailbox_email"),
        ]);
      if (usersError) throw usersError;
      if (mailboxError) throw mailboxError;
      if (permissionError) throw permissionError;
      const authUsers = new Map((userPage.users || []).map(user => [user.id, user]));
      const permissions = new Map<string, string[]>();
      for (const row of permissionRows || []) {
        const list = permissions.get(row.user_id) || [];
        list.push(normalizeMailbox(row.mailbox_email));
        permissions.set(row.user_id, list);
      }
      const members = [...membershipById.entries()].map(([userId, rows]) => {
        const user = authUsers.get(userId);
        return {
          userId, email: user?.email || rows[0]?.mailbox_email || "(unknown email)",
          displayName: String(user?.user_metadata?.display_name || ""),
          active: rows.some(row => row.active === true),
          role: rows.some(row => row.active === true && String(row.role || "").toLowerCase() === "admin") ? "admin" : "user",
          needsSetup: user?.user_metadata?.force_password_change === true ||
            user?.user_metadata?.onboarding_complete !== true ||
            typeof user?.user_metadata?.onboarding_completed_at !== "string",
          mailboxes: [...new Set((permissions.get(userId) || []).filter(Boolean))],
          createdAt: user?.created_at || rows[0]?.created_at || null,
        };
      }).sort((a, b) => a.email.localeCompare(b.email));
      return respond({ members, mailboxes: (mailboxRows || []).map(row => normalizeMailbox(row.email)).filter(Boolean) });
    }

    if (action === "reset_temporary_password") {
      const userId = String(body.userId || "");
      if (!membershipById.has(userId)) return respond({ error: "That account is not in the company email team." }, 404);
      const { data: target, error: targetErr } = await admin.auth.admin.getUserById(userId);
      if (targetErr || !target.user) return respond({ error: "Could not find that team account." }, 404);
      const tempPassword = temporaryPassword();
      const metadata = { ...(target.user.user_metadata || {}), force_password_change: true, onboarding_complete: false, onboarding_completed_at: null };
      const { error: updateErr } = await admin.auth.admin.updateUserById(userId, { password: tempPassword, user_metadata: metadata });
      if (updateErr) throw updateErr;
      return respond({ tempPassword, email: target.user.email, message: "Temporary password created. The user must finish setup after signing in." });
    }

    if (action === "set_mailbox_access") {
      const userId = String(body.userId || "");
      if (!membershipById.has(userId)) return respond({ error: "That account is not in the company email team." }, 404);
      if (!Array.isArray(body.mailboxes)) return respond({ error: "Choose mailbox access to save." }, 400);
      const requested = [...new Set(body.mailboxes.map(normalizeMailbox).filter(Boolean))];
      if (requested.length !== body.mailboxes.length) return respond({ error: "One or more mailbox addresses are invalid." }, 400);
      const { data: activeMailboxes, error: activeErr } = await admin.from("dflandscape_mailboxes").select("email").eq("active", true);
      if (activeErr) throw activeErr;
      const known = new Set((activeMailboxes || []).map(row => normalizeMailbox(row.email)));
      if (requested.some(mailbox => !known.has(mailbox))) return respond({ error: "Only active company mailboxes can be assigned." }, 400);
      const { data: existing, error: existingErr } = await admin.from("dflandscape_mailbox_permissions")
        .select("id,mailbox_email").eq("user_id", userId);
      if (existingErr) throw existingErr;
      const existingRows = existing || [];
      const existingNames = new Set(existingRows.map(row => normalizeMailbox(row.mailbox_email)).filter(Boolean));
      const toAdd = requested.filter(mailbox => !existingNames.has(mailbox));
      const toRemoveRows = existingRows.filter(row => !requested.includes(normalizeMailbox(row.mailbox_email)));
      if (toAdd.length) {
        const { error } = await admin.from("dflandscape_mailbox_permissions").insert(toAdd.map(mailbox_email => ({ user_id: userId, mailbox_email })));
        if (error) throw error;
      }
      if (toRemoveRows.length) {
        const { error } = await admin.from("dflandscape_mailbox_permissions").delete().in("id", toRemoveRows.map(row => row.id)).eq("user_id", userId);
        if (error) throw error;
      }
      return respond({ success: true, mailboxes: requested });
    }

    if (action === "set_role") {
      const userId = String(body.userId || "");
      const role = String(body.role || "").toLowerCase();
      if (!membershipById.has(userId)) return respond({ error: "That account is not in the company email team." }, 404);
      if (!["admin", "user"].includes(role)) return respond({ error: "Choose Admin or Team member." }, 400);
      if (role === "user" && activeMailAdmins.has(userId) && activeMailAdmins.size <= 1) {
        return respond({ error: "At least one active email administrator must remain." }, 400);
      }
      const { error } = await admin.from("dflandscape_mail_access").update({ role }).eq("user_id", userId);
      if (error) throw error;
      return respond({ success: true, role });
    }

    if (action === "set_active") {
      const userId = String(body.userId || "");
      const active = body.active === true;
      if (!membershipById.has(userId)) return respond({ error: "That account is not in the company email team." }, 404);
      if (!active && activeMailAdmins.has(userId) && activeMailAdmins.size <= 1) {
        return respond({ error: "At least one active email administrator must remain." }, 400);
      }
      const { error } = await admin.from("dflandscape_mail_access").update({ active }).eq("user_id", userId);
      if (error) throw error;
      return respond({ success: true, active });
    }

    if (action === "add_member") {
      const email = validEmail(body.email) ? body.email.trim().toLowerCase() : "";
      const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 100) : "";
      if (!email) return respond({ error: "Enter a valid team login email." }, 400);
      if (!displayName) return respond({ error: "Enter the team member's display name." }, 400);
      if (membershipById.size >= 100) return respond({ error: "The team member limit has been reached." }, 400);
      if (!Array.isArray(body.mailboxes)) return respond({ error: "Choose mailbox access for this person." }, 400);
      const requested = [...new Set(body.mailboxes.map(normalizeMailbox).filter(Boolean))];
      if (requested.length !== body.mailboxes.length) return respond({ error: "One or more mailbox addresses are invalid." }, 400);
      const { data: activeMailboxes, error: activeErr } = await admin.from("dflandscape_mailboxes").select("email").eq("active", true);
      if (activeErr) throw activeErr;
      const known = new Set((activeMailboxes || []).map(row => normalizeMailbox(row.email)));
      if (requested.some(mailbox => !known.has(mailbox))) return respond({ error: "Only active company mailboxes can be assigned." }, 400);
      const { data: allUsers, error: allUsersErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (allUsersErr) throw allUsersErr;
      if ((allUsers.users || []).some(user => (user.email || "").toLowerCase() === email)) return respond({ error: "An account already exists with this login email. Use that team member instead." }, 409);
      const tempPassword = temporaryPassword();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password: tempPassword, email_confirm: true,
        user_metadata: { display_name: displayName, force_password_change: true, onboarding_complete: false, onboarding_completed_at: null },
      });
      if (createErr || !created.user) throw createErr || new Error("Could not create the team login.");
      const userId = created.user.id;
      try {
        const { error: accessErr } = await admin.from("dflandscape_mail_access").insert({ user_id: userId, mailbox_email: email, active: true, role: "user" });
        if (accessErr) throw accessErr;
        if (requested.length) {
          const { error: permissionsErr } = await admin.from("dflandscape_mailbox_permissions").insert(requested.map(mailbox_email => ({ user_id: userId, mailbox_email })));
          if (permissionsErr) throw permissionsErr;
        }
      } catch (error) {
        await admin.from("dflandscape_mailbox_permissions").delete().eq("user_id", userId);
        await admin.from("dflandscape_mail_access").delete().eq("user_id", userId);
        await admin.auth.admin.deleteUser(userId);
        throw error;
      }
      return respond({ success: true, userId, email, displayName, tempPassword, message: "Team login created. Share the temporary password securely; first login requires setup." }, 201);
    }

    return respond({ error: "Unknown team-management action." }, 400);
  } catch (error) {
    console.error("admin-team-management failed:", error);
    return respond({ error: error instanceof Error ? error.message : "Team management failed." }, 500);
  }
});