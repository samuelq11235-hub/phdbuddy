import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "@/components/auth/SignupForm";
import { Logo } from "@/components/Logo";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      <Logo className="mb-8" to="/" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Crea tu cuenta</CardTitle>
          <CardDescription>
            Empieza tu primer proyecto de análisis cualitativo en minutos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </div>
  );
}
