import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getAdminToken, setAdminToken, clearAdminToken } from "@/lib/adminAuth";
import { invokeFunction } from "@/lib/apiHelper";

// ═══════════════════════════════════════════════════════════════════
// Admin-only auth context. Password-based login via edge function.
// No Firebase Auth dependency — uses HMAC-signed tokens.
// ═══════════════════════════════════════════════════════════════════

interface AuthContextType {
  isAdmin: boolean;
  loading: boolean;
  adminToken: string | null;
  signIn: (password: string) => Promise<{ error: any }>;
  signOut: () => void;
  /** Call on any 401 from admin endpoints to force logout */
  handleAdminUnauthorized: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adminToken, setTokenState] = useState<string | null>(null);

  // Core logout: only syncs React state (storage+flag already handled by clearAdminToken)
  const syncLogoutState = useCallback(() => {
    setTokenState(null);
    setIsAdmin(false);
  }, []);

  // Full logout: clears storage + flag + dispatches event + syncs React state
  const handleAdminUnauthorized = useCallback(() => {
    clearAdminToken(); // sets flag + removes storage + dispatches admin:unauthorized
    syncLogoutState();
  }, [syncLogoutState]);

  // Listen for global admin:unauthorized events (fired by clearAdminToken from anywhere)
  useEffect(() => {
    window.addEventListener("admin:unauthorized", syncLogoutState);
    return () => window.removeEventListener("admin:unauthorized", syncLogoutState);
  }, [syncLogoutState]);

  // Helper: safely parse a Response as JSON, never throws on HTML/text bodies
  const safeJson = async (res: Response): Promise<any> => {
    try {
      const text = await res.text();
      if (!text) return {};
      try { return JSON.parse(text); } catch { return { _raw: text }; }
    } catch {
      return {};
    }
  };

  // On mount, check if there's a stored token and verify it
  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      setLoading(false);
      return;
    }

    // Verify token with server (single request, no retry)
    invokeFunction("admin-auth", {
      method: "GET",
      headers: { "x-admin-token": token },
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await safeJson(res);
          if (data.valid) {
            setTokenState(token);
            setIsAdmin(true);
          } else {
            handleAdminUnauthorized();
          }
        } else {
          handleAdminUnauthorized();
        }
      })
      .catch(() => {
        handleAdminUnauthorized();
      })
      .finally(() => {
        setLoading(false);
      });
  }, [handleAdminUnauthorized]);

  const signIn = useCallback(async (password: string): Promise<{ error: any }> => {
    try {
      const res = await invokeFunction("admin-auth", {
        method: "POST",
        body: { password },
      });

      const data = await safeJson(res);

      // Detect Vercel's HTML error page (e.g. "A server error has occurred")
      const gotHtml = typeof data?._raw === "string" &&
        (data._raw.trim().startsWith("<") || data._raw.toLowerCase().includes("server error"));

      if (!res.ok || gotHtml) {
        let message: string = data?.error || "";
        if (!message) {
          if (gotHtml) {
            message = "Servidor de autenticação indisponível. Verifique se a variável ADMIN_PASSWORD está configurada no Vercel e tente novamente.";
          } else if (res.status === 401) {
            message = "Senha incorreta.";
          } else if (res.status >= 500) {
            message = "Servidor indisponível no momento. Tente novamente em instantes.";
          } else {
            message = `Falha ao entrar (HTTP ${res.status}).`;
          }
        }
        return { error: { message } };
      }

      if (data?.token) {
        setAdminToken(data.token);
        setTokenState(data.token);
        setIsAdmin(true);
        return { error: null };
      }

      return { error: { message: "Resposta inválida do servidor." } };
    } catch (error: any) {
      const message =
        error?.message?.includes("Failed to fetch") || error?.name === "TypeError"
          ? "Sem conexão com o servidor. Verifique sua internet."
          : (error?.message || "Erro ao conectar.");
      return { error: { message } };
    }
  }, []);

  const signOut = useCallback(() => {
    clearAdminToken();
    setTokenState(null);
    setIsAdmin(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isAdmin, loading, adminToken, signIn, signOut, handleAdminUnauthorized }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
