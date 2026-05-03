import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/LoginForm";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      <Logo className="mb-8" to="/" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Bienvenido de vuelta</CardTitle>
          <CardDescription>Inicia sesión para continuar tu investigación.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
