import { useState } from "react";
import {
  Copy,
  Loader2,
  Mail,
  ShieldAlert,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import {
  canAdmin,
  isOwner,
  useCreateInvitation,
  useMyRole,
  useProjectInvitations,
  useProjectMembers,
  useRemoveMember,
  useRevokeInvitation,
  useUpdateMemberRole,
} from "@/hooks/useMembers";
import { useToast } from "@/hooks/use-toast";
import type {
  InvitableRole,
  ProjectInvitation,
  ProjectMemberWithProfile,
  ProjectRole,
} from "@/types/database";

const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "Propietario",
  admin: "Admin",
  coder: "Codificador",
  viewer: "Solo lectura",
};

const ROLE_DESCRIPTIONS: Record<ProjectRole, string> = {
  owner: "Control total: gestiona miembros y puede borrar el proyecto.",
  admin: "Edita todo el contenido y gestiona invitaciones.",
  coder: "Crea documentos, códigos, citas y memos.",
  viewer: "Solo puede leer el contenido del proyecto.",
};

const INVITABLE_ROLES: InvitableRole[] = ["admin", "coder", "viewer"];

export function MembersPanel({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { data: myRole } = useMyRole(projectId);
  const { data: members, isLoading: membersLoading } = useProjectMembers(projectId);
  const { data: invitations } = useProjectInvitations(projectId);

  const isAdmin = canAdmin(myRole);
  const ownerView = isOwner(myRole);

  return (
    <div className="space-y-8">
      <section>
        <header className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Miembros</h2>
            <p className="text-sm text-muted-foreground">
              Personas con acceso a este proyecto.
            </p>
          </div>
        </header>

        {membersLoading ? (
          <MembersSkeleton />
        ) : members && members.length > 0 ? (
          <ul className="divide-y rounded-lg border bg-card">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                isMe={m.user_id === user?.id}
                canManage={ownerView && m.user_id !== user?.id}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            Aún no hay miembros listados.
          </p>
        )}
      </section>

      {isAdmin && (
        <section>
          <header className="mb-3">
            <h2 className="text-xl font-semibold tracking-tight">Invitar</h2>
            <p className="text-sm text-muted-foreground">
              Genera un enlace de invitación. Caduca en 14 días.
            </p>
          </header>
          <InvitationForm projectId={projectId} />
        </section>
      )}

      {isAdmin && invitations && invitations.length > 0 && (
        <section>
          <header className="mb-3">
            <h2 className="text-xl font-semibold tracking-tight">
              Invitaciones pendientes
            </h2>
          </header>
          <ul className="divide-y rounded-lg border bg-card">
            {invitations.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MembersSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

function MemberRow({
  member,
  isMe,
  canManage,
}: {
  member: ProjectMemberWithProfile;
  isMe: boolean;
  canManage: boolean;
}) {
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const { toast } = useToast();

  const profile = member.profile;
  const displayName = profile?.full_name?.trim() || member.user_id.slice(0, 8);
  const initials =
    profile?.full_name
      ?.split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";

  async function handleRoleChange(next: ProjectRole) {
    if (next === member.role) return;
    try {
      await updateRole.mutateAsync({ memberId: member.id, role: next });
      toast({ title: `Rol actualizado a ${ROLE_LABELS[next]}` });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo cambiar el rol",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function handleRemove() {
    if (
      !confirm(
        `¿Eliminar a ${displayName} del proyecto? Sus citas y códigos quedarán pero ya no podrá acceder.`
      )
    )
      return;
    try {
      await removeMember.mutateAsync({
        id: member.id,
        project_id: member.project_id,
        user_id: member.user_id,
      });
      toast({ title: "Miembro eliminado" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo eliminar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar className="h-9 w-9">
        {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={displayName} />}
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {displayName} {isMe && <span className="text-muted-foreground">(tú)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {ROLE_DESCRIPTIONS[member.role]}
        </p>
      </div>
      {canManage ? (
        <div className="flex items-center gap-2">
          <Select
            value={member.role}
            onValueChange={(v) => handleRoleChange(v as ProjectRole)}
            disabled={updateRole.isPending || member.role === "owner"}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROLE_LABELS) as ProjectRole[])
                .filter((r) => r !== "owner")
                .map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={handleRemove}
            disabled={removeMember.isPending || member.role === "owner"}
            aria-label="Eliminar miembro"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {ROLE_LABELS[member.role]}
        </span>
      )}
    </li>
  );
}

function InvitationForm({ projectId }: { projectId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("coder");
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const createInvite = useCreateInvitation();
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      const resp = await createInvite.mutateAsync({
        projectId,
        email: email.trim(),
        role,
      });
      setLastUrl(resp.inviteUrl);
      setEmail("");
      toast({
        title: "Invitación creada",
        description: "Copia el enlace y compártelo con la persona invitada.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo enviar la invitación",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  async function copyLink() {
    if (!lastUrl) return;
    try {
      await navigator.clipboard.writeText(lastUrl);
      toast({ title: "Enlace copiado" });
    } catch {
      toast({ variant: "destructive", title: "No se pudo copiar" });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
        <div className="space-y-1">
          <Label htmlFor="invite-email" className="text-xs">
            Email
          </Label>
          <Input
            id="invite-email"
            type="email"
            placeholder="colega@universidad.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="invite-role" className="text-xs">
            Rol
          </Label>
          <Select value={role} onValueChange={(v) => setRole(v as InvitableRole)}>
            <SelectTrigger id="invite-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INVITABLE_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={createInvite.isPending}>
            {createInvite.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-2 h-4 w-4" />
            )}
            Crear invitación
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {ROLE_DESCRIPTIONS[role]}
      </p>
      {lastUrl && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <Mail className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <code className="flex-1 truncate text-xs">{lastUrl}</code>
          <Button type="button" size="sm" variant="ghost" onClick={copyLink}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            Copiar
          </Button>
        </div>
      )}
    </form>
  );
}

function InvitationRow({ invitation }: { invitation: ProjectInvitation }) {
  const revoke = useRevokeInvitation();
  const { toast } = useToast();

  const expired = new Date(invitation.expires_at).getTime() < Date.now();
  const status = invitation.revoked_at
    ? "Revocada"
    : invitation.accepted_at
    ? "Aceptada"
    : expired
    ? "Caducada"
    : "Pendiente";

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/invite/${invitation.token}`
      : "";

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast({ title: "Enlace copiado" });
    } catch {
      toast({ variant: "destructive", title: "No se pudo copiar" });
    }
  }

  async function handleRevoke() {
    try {
      await revoke.mutateAsync({ id: invitation.id, project_id: invitation.project_id });
      toast({ title: "Invitación revocada" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo revocar",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  const muted = !!invitation.revoked_at || !!invitation.accepted_at || expired;

  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${muted ? "opacity-60" : ""}`}>
      <Mail className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{invitation.email}</p>
        <p className="text-xs text-muted-foreground">
          {ROLE_LABELS[invitation.role]} · {status}
        </p>
      </div>
      {!muted && (
        <>
          <Button type="button" size="sm" variant="ghost" onClick={copyLink}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            Enlace
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={handleRevoke}
            disabled={revoke.isPending}
            aria-label="Revocar invitación"
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      )}
    </li>
  );
}

export function MembersPanelGate({ projectId }: { projectId: string }) {
  const { data: myRole, isLoading } = useMyRole(projectId);
  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (!myRole) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        <ShieldAlert className="h-4 w-4" />
        No tienes acceso a este proyecto.
      </div>
    );
  }
  return <MembersPanel projectId={projectId} />;
}
