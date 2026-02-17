import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { User } from "firebase/auth";

// ═══════════════════════════════════════════════════════════════════
// Admin-only auth context. No user signups, no Google login, no
// blocked emails. Firebase Auth is used exclusively for admin access.
// ═══════════════════════════════════════════════════════════════════

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  roleLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ROLE_CACHE_KEY = 'valnix_role_cache_v1';
const ROLE_CACHE_TTL = 10 * 60 * 1000;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);

  const getCachedRole = useCallback((uid: string): boolean | null => {
    try {
      const raw = localStorage.getItem(ROLE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.uid !== uid || Date.now() - parsed.ts > ROLE_CACHE_TTL) return null;
      return parsed.isAdmin === true;
    } catch { return null; }
  }, []);

  const setCachedRole = useCallback((uid: string, admin: boolean) => {
    try {
      localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ uid, isAdmin: admin, ts: Date.now() }));
    } catch {}
  }, []);

  // ── Role check via Edge Function ──
  const checkRoleViaApi = useCallback(async (firebaseUser: User): Promise<boolean> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const token = await firebaseUser.getIdToken();
      const baseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${baseUrl}/functions/v1/site-data?type=check-role`, {
        signal: controller.signal,
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data.isAdmin === true;
    } catch { return false; }
    finally { clearTimeout(timeoutId); }
  }, []);

  // ── Role check via Firestore (lazy-loaded) ──
  const checkRoleViaFirestore = useCallback(async (uid: string): Promise<boolean> => {
    try {
      const [config, fs] = await Promise.all([
        import("@/integrations/firebase/config"),
        import("firebase/firestore"),
      ]);
      const roleResult = await Promise.race([
        fs.getDoc(fs.doc(config.db, "user_roles", uid)),
        new Promise<null>((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (!roleResult) return false;
      return roleResult.exists?.() && roleResult.data()?.role === "admin";
    } catch { return false; }
  }, []);

  const resolveAdminRole = useCallback(async (firebaseUser: User): Promise<boolean> => {
    let firestoreResult: boolean | null = null;
    let apiResult: boolean | null = null;

    const fsFetch = checkRoleViaFirestore(firebaseUser.uid)
      .then(r => { firestoreResult = r; return r; }).catch(() => null);
    const apiFetch = checkRoleViaApi(firebaseUser)
      .then(r => { apiResult = r; return r; }).catch(() => null);

    const first = await Promise.race([fsFetch, apiFetch]);
    if (first === true) return true;

    await Promise.allSettled([fsFetch, apiFetch]);
    return firestoreResult === true || apiResult === true;
  }, [checkRoleViaFirestore, checkRoleViaApi]);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      const [config, authMod] = await Promise.all([
        import("@/integrations/firebase/config"),
        import("firebase/auth"),
      ]);

      if (!alive) return;

      unsubscribe = authMod.onAuthStateChanged(config.auth, async (firebaseUser) => {
        if (!alive) return;

        setIsAdmin(false);
        setUser(firebaseUser);

        if (!firebaseUser) {
          setLoading(false);
          setRoleLoading(false);
          return;
        }

        setRoleLoading(true);
        setLoading(false);

        const cachedAdmin = getCachedRole(firebaseUser.uid);
        if (cachedAdmin === true && alive) setIsAdmin(true);

        const serverAdmin = await resolveAdminRole(firebaseUser);
        if (alive) {
          setIsAdmin(serverAdmin);
          setRoleLoading(false);
          setCachedRole(firebaseUser.uid, serverAdmin);
        }
      });
    };

    // Defer Firebase init to after first paint
    const ric = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 100));
    ric(() => { init(); });

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [getCachedRole, setCachedRole, resolveAdminRole]);

  const signIn = useCallback(async (email: string, password: string): Promise<{ error: any }> => {
    try {
      try { localStorage.removeItem(ROLE_CACHE_KEY); } catch {}
      const [config, authMod] = await Promise.all([
        import("@/integrations/firebase/config"),
        import("firebase/auth"),
      ]);
      await authMod.signInWithEmailAndPassword(config.auth, email, password);
      return { error: null };
    } catch (error) { return { error }; }
  }, []);

  const signOut = useCallback(async () => {
    const [config, authMod] = await Promise.all([
      import("@/integrations/firebase/config"),
      import("firebase/auth"),
    ]);
    await authMod.signOut(config.auth);
    setIsAdmin(false);
    try { localStorage.removeItem(ROLE_CACHE_KEY); } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, roleLoading, signIn, signOut }}>
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
