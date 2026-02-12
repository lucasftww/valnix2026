import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useAuth } from "@/contexts/FirebaseAuthContext";
import { useToast } from "@/hooks/use-toast";
import { isTempEmail } from "@/lib/tempEmailDomains";
import vLogo from "@/assets/v-logo-login.png";


export default function Auth() {
  const [searchParams] = useSearchParams();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("login");
  
  const { signIn, signUp, signInWithGoogle, user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const redirectTo = searchParams.get("redirect") || "/";

  useEffect(() => {
    if (user) {
      navigate(redirectTo, { replace: true });
    }
  }, [user, navigate, redirectTo]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    const { error } = await signIn(loginEmail, loginPassword);
    
    if (!error) {
      navigate(redirectTo, { replace: true });
    } else {
      const code = (error as any)?.code || '';
      const msg = code === 'auth/wrong-password' || code === 'auth/invalid-credential'
        ? 'Email ou senha incorretos.'
        : code === 'auth/user-not-found'
          ? 'Nenhuma conta encontrada com este email.'
          : code === 'auth/too-many-requests'
            ? 'Muitas tentativas. Tente novamente em alguns minutos.'
            : 'Erro ao entrar. Verifique suas credenciais.';
      toast({
        title: "Erro ao entrar",
        description: msg,
        variant: "destructive",
      });
    }
    
    setLoading(false);
  };


  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isTempEmail(signupEmail)) {
      toast({
        title: "Email não permitido",
        description: "Não aceitamos emails temporários ou descartáveis. Use um email real.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    
    const { error } = await signUp(signupEmail, signupPassword);
    
    if (!error) {
      setSignupEmail("");
      setSignupPassword("");
    }
    
    setLoading(false);
  };

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col items-center justify-center bg-gradient-to-b from-background via-background to-background/95 overflow-x-hidden px-4 py-6">
        {/* Logo com link para home */}
        <Link to="/" className="flex items-center justify-center mb-6 sm:mb-8 hover:opacity-90 transition-opacity">
          <img src={vLogo} alt="Valnix Logo" className="h-16 sm:h-20 md:h-24 w-auto drop-shadow-lg" />
        </Link>
        
        <Card className="w-full max-w-md shadow-2xl border-primary/20 bg-card/95 backdrop-blur-sm">
          <CardHeader className="space-y-1.5 px-5 sm:px-6 pt-6 pb-4 sm:pt-7 sm:pb-5 text-center">
            <CardTitle className="text-2xl sm:text-3xl font-bold">
              Bem-vindo
            </CardTitle>
            <CardDescription className="text-sm sm:text-base">
              Entre ou crie sua conta para continuar
            </CardDescription>
          </CardHeader>
          <CardContent className="px-5 sm:px-6 pb-6 sm:pb-7">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-5 sm:mb-6 h-12 sm:h-14 p-1 rounded-xl bg-muted/50">
                  <TabsTrigger 
                    value="login" 
                    className="text-sm sm:text-base font-semibold rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
                  >
                    Entrar
                  </TabsTrigger>
                  <TabsTrigger 
                    value="signup" 
                    className="text-sm sm:text-base font-semibold rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all"
                  >
                    Criar Conta
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="login" className="mt-0">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email" className="text-sm font-medium">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="seu@email.com"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        required
                        className="h-12 sm:h-14 text-base rounded-xl border-2 focus:border-primary transition-colors"
                        autoComplete="email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password" className="text-sm font-medium">Senha</Label>
                      <Input
                        id="login-password"
                        type="password"
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                        className="h-12 sm:h-14 text-base rounded-xl border-2 focus:border-primary transition-colors"
                        autoComplete="current-password"
                      />
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full h-14 text-base font-bold rounded-xl shadow-lg hover:shadow-xl transition-all bg-primary hover:bg-primary/90" 
                      disabled={loading}
                    >
                      {loading ? "Entrando..." : "Entrar"}
                    </Button>

                    <div className="relative my-4">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">ou continue com</span>
                      </div>
                    </div>

                    <Button 
                      type="button" 
                      variant="outline"
                      className="w-full h-14 text-base font-medium rounded-xl border-2 hover:bg-accent transition-all flex items-center justify-center gap-3"
                      disabled={loading}
                      onClick={async () => {
                        setLoading(true);
                        try {
                          const { error } = await signInWithGoogle();
                          if (!error) {
                            navigate(redirectTo, { replace: true });
                          }
                        } catch (err: any) {
                          // Error handled in context
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      Continuar com Google
                    </Button>
                    
                  </form>
                </TabsContent>
                
                <TabsContent value="signup" className="mt-0">
                  <form onSubmit={handleSignup} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signup-email" className="text-sm font-medium">Email</Label>
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="seu@email.com"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        required
                        className="h-12 sm:h-14 text-base rounded-xl border-2 focus:border-primary transition-colors"
                        autoComplete="email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password" className="text-sm font-medium">Senha</Label>
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder="••••••••"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        required
                        minLength={8}
                        className="h-12 sm:h-14 text-base rounded-xl border-2 focus:border-primary transition-colors"
                        autoComplete="new-password"
                      />
                      <p className="text-xs text-muted-foreground">
                        Use no mínimo 8 caracteres com letras e números
                      </p>
                    </div>
                    
                    <Button 
                      type="submit" 
                      className="w-full h-14 text-base font-bold rounded-xl shadow-lg hover:shadow-xl transition-all bg-primary hover:bg-primary/90" 
                      disabled={loading}
                    >
                      {loading ? "Criando conta..." : "Criar Conta Grátis"}
                    </Button>

                    <div className="relative my-4">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">ou continue com</span>
                      </div>
                    </div>

                    <Button 
                      type="button" 
                      variant="outline"
                      className="w-full h-14 text-base font-medium rounded-xl border-2 hover:bg-accent transition-all flex items-center justify-center gap-3"
                      disabled={loading}
                      onClick={async () => {
                        setLoading(true);
                        try {
                          const { error } = await signInWithGoogle();
                          if (!error) {
                            navigate(redirectTo, { replace: true });
                          }
                        } catch (err: any) {
                          // Error handled in context
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      Continuar com Google
                    </Button>
                    
                  </form>
                </TabsContent>
              </Tabs>
          </CardContent>
        </Card>

        {/* Trust text */}
        <p className="text-xs text-muted-foreground text-center mt-5 sm:mt-6 max-w-xs">
          Seus dados estão protegidos e nunca serão compartilhados
        </p>
    </div>
  );
}
