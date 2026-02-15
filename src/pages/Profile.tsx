import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Camera, User, Package, Loader2, Check, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/FirebaseAuthContext";
import { db, auth } from "@/integrations/firebase/config";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { invokeFunction } from "@/lib/apiHelper";
import imageCompression from "browser-image-compression";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRecentOrders } from "@/hooks/firebase";

interface Profile {
  id: string;
  full_name: string | null;
  nickname: string | null;
  phone: string | null;
  avatar_url: string | null;
  balance?: number | null;
}

export default function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [uploading, setUploading] = useState(false);

  // Buscar perfil do usuário - agora do Firebase
  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile", user?.uid],
    queryFn: async () => {
      if (!user?.uid) return null;
      const docRef = doc(db, "profiles", user.uid);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        return { 
          id: docSnap.id, 
          full_name: data.full_name || null,
          nickname: data.nickname || null,
          phone: data.phone || null,
          avatar_url: data.avatar_url || null,
          balance: data.balance ?? null,
        } as Profile;
      }
      
      // Se não existe, cria um perfil vazio
      const newProfile: Profile = {
        id: user.uid,
        full_name: user.displayName || null,
        nickname: null,
        phone: null,
        avatar_url: user.photoURL || null,
        balance: 0,
      };
      await setDoc(docRef, newProfile);
      return newProfile;
    },
    enabled: !!user?.uid,
  });

  // Buscar pedidos recentes do Firebase
  const { orders: recentOrders, loading: ordersLoading } = useRecentOrders(user?.uid);

  // Preencher campos quando o perfil carregar
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setNickname(profile.nickname || "");
      setPhone(profile.phone || "");
    }
  }, [profile]);

  // Mutation para atualizar perfil - agora no Firebase
  const updateProfileMutation = useMutation({
    mutationFn: async (updates: Partial<Profile>) => {
      if (!user?.uid) throw new Error("Usuário não autenticado");
      
      const docRef = doc(db, "profiles", user.uid);
      await updateDoc(docRef, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.uid] });
      toast({
        title: "Perfil atualizado!",
        description: "Suas informações foram salvas com sucesso.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao atualizar",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Upload de avatar - agora para Firebase Storage
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.uid) return;

    // Validar tipo e tamanho
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Arquivo inválido",
        description: "Por favor, selecione uma imagem.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "Arquivo muito grande",
        description: "A imagem deve ter no máximo 2MB.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      // Compress to WebP
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.3,
        maxWidthOrHeight: 400,
        useWebWorker: true,
        fileType: "image/webp" as const,
      });

      const fileName = `avatars/${user.uid}/avatar.webp`;

      // Convert to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(compressed);
      });

      // Get Firebase auth token
      const token = await auth.currentUser!.getIdToken();

      // Upload via R2 edge function
      const response = await invokeFunction("upload-r2", {
        body: { fileBase64: base64, fileName, contentType: "image/webp" },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Falha no upload");
      }

      const { url: downloadUrl } = await response.json();

      // Atualizar perfil com a nova URL
      await updateProfileMutation.mutateAsync({
        avatar_url: downloadUrl,
      });

      toast({
        title: "Foto atualizada!",
        description: "Sua foto de perfil foi alterada via R2.",
      });
    } catch (error: any) {
      toast({
        title: "Erro no upload",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = () => {
    updateProfileMutation.mutate({
      full_name: fullName || null,
      nickname: nickname || null,
      phone: phone || null,
    });
  };

  const getInitials = () => {
    if (nickname) return nickname.slice(0, 2).toUpperCase();
    if (fullName) return fullName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
    if (user?.email) return user.email.slice(0, 2).toUpperCase();
    return "US";
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "text-green-500";
      case "processing": return "text-blue-500";
      case "pending": return "text-yellow-500";
      case "cancelled": return "text-red-500";
      default: return "text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "completed": return "Concluído";
      case "processing": return "Processando";
      case "pending": return "Pendente";
      case "cancelled": return "Cancelado";
      default: return status;
    }
  };

  if (!user) {
    navigate("/auth");
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border/30">
        <div className="container flex items-center h-14 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="ml-3 text-lg font-bold">Meu Perfil</h1>
        </div>
      </div>

      <div className="container px-4 py-6 max-w-2xl mx-auto">
        {/* Avatar Section */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative">
            <Avatar className="h-28 w-28 border-4 border-primary/20">
              <AvatarImage src={profile?.avatar_url || ""} alt="Avatar" />
              <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">
                {getInitials()}
              </AvatarFallback>
            </Avatar>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute bottom-0 right-0 bg-primary text-primary-foreground p-2.5 rounded-full shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
          </div>
          <p className="mt-3 text-lg font-semibold">
            {nickname || fullName || user.email?.split("@")[0]}
          </p>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          
          {/* Saldo do usuário */}
          {profile?.balance !== null && profile?.balance !== undefined && profile.balance > 0 && (
            <div className="mt-4 flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full">
              <Wallet className="h-4 w-4" />
              <span className="font-semibold">
                Saldo: R$ {profile.balance.toFixed(2).replace('.', ',')}
              </span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="profile" className="gap-2">
              <User className="h-4 w-4" />
              Dados
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <Package className="h-4 w-4" />
              Pedidos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Informações Pessoais</CardTitle>
                <CardDescription>
                  Atualize seus dados de perfil
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="nickname">Apelido</Label>
                  <Input
                    id="nickname"
                    placeholder="Como você quer ser chamado?"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fullName">Nome Completo</Label>
                  <Input
                    id="fullName"
                    placeholder="Seu nome completo"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Telefone</Label>
                  <Input
                    id="phone"
                    placeholder="(00) 00000-0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-12"
                  />
                </div>

                <Button
                  onClick={handleSaveProfile}
                  disabled={updateProfileMutation.isPending}
                  className="w-full h-12 mt-4"
                >
                  {updateProfileMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Salvar Alterações
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pedidos Recentes</CardTitle>
                <CardDescription>
                  Seus últimos 5 pedidos
                </CardDescription>
              </CardHeader>
              <CardContent>
                {recentOrders.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>Nenhum pedido ainda</p>
                    <Link to="/">
                      <Button variant="link" className="mt-2">
                        Ver produtos
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentOrders.map((order) => (
                      <Link
                        key={order.id}
                        to="/my-orders"
                        className="flex items-center justify-between p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            Pedido #{order.id.slice(0, 8)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(order.created_at)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-primary">
                            R$ {order.total_amount.toFixed(2)}
                          </p>
                          <p className={`text-xs ${getStatusColor(order.status || "pending")}`}>
                            {getStatusLabel(order.status || "pending")}
                          </p>
                        </div>
                      </Link>
                    ))}

                    <Link to="/my-orders" className="block">
                      <Button variant="outline" className="w-full mt-4">
                        Ver todos os pedidos
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
