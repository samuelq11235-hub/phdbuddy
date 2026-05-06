// Edge Function: send-invitation
// Creates a project_invitations row and returns an invite URL the
// caller can share with the recipient. Email delivery is intentionally
// out-of-scope for F5 — wire Resend/Supabase invite-by-email later.
//
// Authorization: caller must be admin or owner of the project. Service
// role is used only to write the invitation (no RLS surprises).

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";

interface RequestBody {
  projectId: string;
  email: string;
  role?: "admin" | "coder" | "viewer";
  // Where the user lands after accepting. Falls back to a relative URL
  // so the frontend can prepend its own origin.
  appOrigin?: string;
}

const TOKEN_BYTES = 24; // 192 bits → 48 hex chars

function generateToken(): string {
  const buf = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let userId: string;
  let userEmail: string | null = null;
  try {
    const auth = await getUserFromRequest(req);
    userId = auth.userId;
    const { data: u } = await auth.client.auth.getUser();
    userEmail = u.user?.email ?? null;
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : "Unauthorized", 401);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { projectId, email, role: roleRaw, appOrigin } = body;
  if (!projectId) return errorResponse("Missing projectId", 400);
  const normalizedEmail = email ? normalizeEmail(email) : "";
  if (!normalizedEmail || !isEmail(normalizedEmail)) {
    return errorResponse("Invalid email", 400);
  }
  const role = roleRaw ?? "coder";
  if (!["admin", "coder", "viewer"].includes(role)) {
    return errorResponse("Invalid role", 400);
  }
  if (userEmail && normalizeEmail(userEmail) === normalizedEmail) {
    return errorResponse("Cannot invite yourself", 400);
  }

  const supabase = getServiceClient();

  // Authorization: caller must be admin/owner.
  const { data: membership, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memErr) return errorResponse(`Membership lookup failed: ${memErr.message}`, 500);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return errorResponse("Only project owners or admins can send invitations", 403);
  }

  // Don't issue duplicate active invites for the same email/project.
  const { data: existing, error: existErr } = await supabase
    .from("project_invitations")
    .select("id, token, expires_at, accepted_at, revoked_at")
    .eq("project_id", projectId)
    .ilike("email", normalizedEmail)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (existErr && existErr.code !== "PGRST116") {
    return errorResponse(`Invitation lookup failed: ${existErr.message}`, 500);
  }

  let token: string;
  let invitationId: string;

  if (existing) {
    token = existing.token;
    invitationId = existing.id;
  } else {
    token = generateToken();
    const { data, error } = await supabase
      .from("project_invitations")
      .insert({
        project_id: projectId,
        email: normalizedEmail,
        role,
        token,
        invited_by: userId,
      })
      .select("id, token")
      .single();
    if (error || !data) {
      return errorResponse(`Failed to create invitation: ${error?.message ?? "unknown"}`, 500);
    }
    invitationId = data.id;
  }

  const origin = appOrigin?.replace(/\/$/, "") ?? "";
  const inviteUrl = `${origin}/invite/${token}`;

  return jsonResponse({
    ok: true,
    invitationId,
    token,
    inviteUrl,
    email: normalizedEmail,
    role,
  });
});
