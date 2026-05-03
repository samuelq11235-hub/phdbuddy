import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { getInitials } from "@/lib/utils";

export default function SettingsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();

  const [fullName, setFullName] = useState("");
  const [institution, setInstitution] = useState("");
  const [field, setField] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setInstitution(profile?.institution ?? "");
    setField(profile?.field_of_study ?? "");
  }, [profile?.id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          full_name: fullName.trim() || null,
          institution: institution.trim() || null,
          field_of_study: field.trim() || null,
        });
      if (error) throw error;
      await refreshProfile();
      toast({ title: "Perfil actualizado" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "No se pudo guardar",
        description: err instanceof Error ? err.message : "Inténtalo de nuevo.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestiona la información de tu perfil.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>Esta información ayuda a personalizar PHDBuddy.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                {profile?.avatar_url && (
                  <AvatarImage src={profile.avatar_url} alt={fullName || ""} />
                )}
                <AvatarFallback>{getInitials(fullName || user?.email)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{user?.email}</p>
                <p className="text-sm text-muted-foreground">Sesión iniciada</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fullName">Nombre completo</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ada Lovelace"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="institution">Institución</Label>
                <Input
                  id="institution"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  placeholder="Universidad de Cambridge"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="field">Campo de estudio</Label>
                <Input
                  id="field"
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                  placeholder="Sociología, Educación, Salud pública..."
                />
              </div>
            </div>

            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar cambios
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
