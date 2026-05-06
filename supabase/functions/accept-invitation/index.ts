// Edge Function: accept-invitation
// Resolves an invitation token and adds the calling user to the
// project as a member. Runs with service role because the new member
// is, by definition, NOT yet a project_members row — so direct RLS
// inserts wouldn't be permitted.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getServiceClient, getUserFromRequest } from "../_shared/supabase.ts";

interface RequestBody {
  token: string;
}

interface InvitationRow {
  id: string;
  project_id: string;
  email: string;
  role: "admin" | "coder" | "viewer";
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
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

  if (!userEmail) {
    return errorResponse("Account has no email — cannot accept invitations", 400);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const { token } = body;
  if (!token || typeof token !== "string") {
    return errorResponse("Missing token", 400);
  }

  const supabase = getServiceClient();

  const { data: invite, error: inviteErr } = await supabase
    .from("project_invitations")
    .select("id, project_id, email, role, expires_at, accepted_at, revoked_at")
    .eq("token", token)
    .maybeSingle<InvitationRow>();

  if (inviteErr) {
    return errorResponse(`Invitation lookup failed: ${inviteErr.message}`, 500);
  }
  if (!invite) {
    return errorResponse("Invitation not found", 404);
  }
  if (invite.revoked_at) {
    return errorResponse("Invitation has been revoked", 410);
  }
  if (invite.accepted_at) {
    return errorResponse("Invitation has already been accepted", 409);
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return errorResponse("Invitation has expired", 410);
  }
  if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
    return errorResponse(
      "This invitation was sent to a different email address. Please sign in with the invited account.",
      403
    );
  }

  // Upsert membership. If the user is already a member with the same or
  // higher role, we don't downgrade — but we DO bump them up if the
  // invite carries a stronger role.
  const { data: existingMember } = await supabase
    .from("project_members")
    .select("id, role")
    .eq("project_id", invite.project_id)
    .eq("user_id", userId)
    .maybeSingle<{ id: string; role: "owner" | "admin" | "coder" | "viewer" }>();

  const ROLE_RANK: Record<string, number> = {
    owner: 4,
    admin: 3,
    coder: 2,
    viewer: 1,
  };

  if (existingMember) {
    if (ROLE_RANK[invite.role] > ROLE_RANK[existingMember.role]) {
      const { error } = await supabase
        .from("project_members")
        .update({ role: invite.role })
        .eq("id", existingMember.id);
      if (error) return errorResponse(`Failed to promote member: ${error.message}`, 500);
    }
  } else {
    const { error } = await supabase
      .from("project_members")
      .insert({
        project_id: invite.project_id,
        user_id: userId,
        role: invite.role,
      });
    if (error) return errorResponse(`Failed to add member: ${error.message}`, 500);
  }

  // Mark the invitation as consumed.
  const { error: markErr } = await supabase
    .from("project_invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);
  if (markErr) {
    console.warn("[accept-invitation] could not mark invitation accepted:", markErr.message);
  }

  // Fetch the project so the client can route to it without a second
  // round-trip.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", invite.project_id)
    .maybeSingle<ProjectRow>();

  return jsonResponse({
    ok: true,
    projectId: invite.project_id,
    projectName: project?.name ?? null,
    role: invite.role,
  });
});
