import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { auth, db } from "@/integrations/firebase/config";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { isBlockedEmail, isBlockedUid, isSpamEmailPattern } from "@/lib/blockedEmails";

// ── Security: admin role is determined ONLY by "user_roles" collection ──
// The "users" collection is NOT trusted for admin status (users can write to it)
// The "user_roles" collection must be write-protected by Firestore Security Rules

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  roleLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ── Constants ──
const ROLE_CACHE_KEY = 'valnix_role_cache_v1';
const ROLE_CACHE_TTL = 10 * 60 * 1000; // 10 min
const FIRESTORE_TIMEOUT_MS = 5000; // 5s for slow connections

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(false);

  // ── Cached role check with TTL ──
  const getCachedRole = useCallback((uid: string): boolean | null => {
    try {
      const raw = localStorage.getItem(ROLE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.uid !== uid) return null;
      if (Date.now() - parsed.ts > ROLE_CACHE_TTL) return null;
      return parsed.isAdmin === true;
    } catch { return null; }
  }, []);

  const setCachedRole = useCallback((uid: string, admin: boolean) => {
    try {
      localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ uid, isAdmin: admin, ts: Date.now() }));
    } catch { /* quota */ }
  }, []);

  // ── Role check via Firestore with timeout ──
  const checkRoleViaFirestore = useCallback(async (uid: string): Promise<boolean> => {
    const roleResult = await Promise.race([
      getDoc(doc(db, "user_roles", uid)),
      new Promise<null>((r) => setTimeout(() => r(null), FIRESTORE_TIMEOUT_MS)),
    ]);
    if (!roleResult) return false; // timeout
    return roleResult.exists?.() && roleResult.data()?.role === "admin";
  }, []);

  // ── Role check via Edge Function (authenticated with Firebase ID token) ──
  const checkRoleViaApi = useCallback(async (firebaseUser: User): Promise<boolean> => {
    try {
      const token = await firebaseUser.getIdToken();
      const baseUrl = import.meta.env.VITE_SUPABASE_URL;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${baseUrl}/functions/v1/site-data?type=check-role`, {
        signal: controller.signal,
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${token}`,
        },
      });
      clearTimeout(timeoutId);
      if (!res.ok) return false;
      const data = await res.json();
      return data.isAdmin === true;
    } catch {
      return false;
    }
  }, []);

  // ── Resolve admin role via race (Firestore vs API) ──
  const resolveAdminRole = useCallback(async (firebaseUser: User): Promise<boolean> => {
    let firestoreResult: boolean | null = null;
    let apiResult: boolean | null = null;

    const fsFetch = checkRoleViaFirestore(firebaseUser.uid)
      .then(r => { firestoreResult = r; return r; })
      .catch(() => null);
    const apiFetch = checkRoleViaApi(firebaseUser)
      .then(r => { apiResult = r; return r; })
      .catch(() => null);

    const first = await Promise.race([fsFetch, apiFetch]);
    if (first === true) return true;

    // If first was false/null, wait for the other
    await Promise.allSettled([fsFetch, apiFetch]);
    return firestoreResult === true || apiResult === true;
  }, [checkRoleViaFirestore, checkRoleViaApi]);

  useEffect(() => {
    let alive = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!alive) return;

      // ── CRITICAL: always reset admin state immediately on user change ──
      setIsAdmin(false);
      setUser(firebaseUser);

      if (!firebaseUser) {
        setLoading(false);
        setRoleLoading(false);
        return;
      }

      // Block banned UIDs immediately
      if (isBlockedUid(firebaseUser.uid)) {
        await firebaseSignOut(auth);
        setUser(null);
        setLoading(false);
        setRoleLoading(false);
        return;
      }

      // Block spam email patterns
      if (firebaseUser.email && (isBlockedEmail(firebaseUser.email) || isSpamEmailPattern(firebaseUser.email))) {
        await firebaseSignOut(auth);
        setUser(null);
        setLoading(false);
        setRoleLoading(false);
        return;
      }

      // Use .some() for reliable provider check
      const isPasswordProvider = firebaseUser.providerData?.some(p => p.providerId === 'password') ?? false;
      const isUnverifiedPassword = isPasswordProvider && !firebaseUser.emailVerified;

      // ── Admin role check ──
      setRoleLoading(true);
      setLoading(false); // auth is resolved, role is still loading

      const cachedAdmin = getCachedRole(firebaseUser.uid);

      // Cache hint for non-admin UI (e.g. show admin link in header faster)
      if (cachedAdmin === true && alive) setIsAdmin(true);

      // ALWAYS validate server-side before releasing roleLoading
      const serverAdmin = await resolveAdminRole(firebaseUser);
      if (alive) {
        setIsAdmin(serverAdmin);
        setRoleLoading(false);
        setCachedRole(firebaseUser.uid, serverAdmin);
      }

      // Non-blocking: handle users/profile docs in background
      // Skip for unverified password accounts to prevent quota drain attacks
      if (!isUnverifiedPassword) {
        setTimeout(() => {
          if (!alive) return;
          (async () => {
            try {
              const [userDoc, profileDoc] = await Promise.all([
                getDoc(doc(db, "users", firebaseUser.uid)),
                getDoc(doc(db, "profiles", firebaseUser.uid)),
              ]);

              if (!alive) return;

              if (!userDoc.exists()) {
                await setDoc(doc(db, "users", firebaseUser.uid), {
                  email: firebaseUser.email,
                  role: "user",
                  isAdmin: false,
                  created_at: new Date().toISOString(),
                });
              }

              if (!alive) return;

              if (!profileDoc.exists()) {
                await setDoc(doc(db, "profiles", firebaseUser.uid), {
                  email: firebaseUser.email,
                  full_name: firebaseUser.displayName || null,
                  balance: 0,
                  created_at: new Date().toISOString(),
                });
              }
            } catch {
              // Background sync — non-critical
            }
          })();
        }, 3000);
      }
    });

    return () => { alive = false; unsubscribe(); };
  }, [getCachedRole, setCachedRole, resolveAdminRole]);

  const signIn = useCallback(async (email: string, password: string): Promise<{ error: any }> => {
    if (isBlockedEmail(email)) {
      return { error: { code: 'auth/blocked', message: 'Account suspended' } };
    }
    try {
      try { localStorage.removeItem(ROLE_CACHE_KEY); } catch { /* */ }
      await signInWithEmailAndPassword(auth, email, password);
      return { error: null };
    } catch (error) {
      return { error };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<{ error: any }> => {
    if (isBlockedEmail(email) || isSpamEmailPattern(email)) {
      return { error: { code: 'auth/blocked', message: 'Account suspended' } };
    }
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (!isSpamEmailPattern(email)) {
        await setDoc(doc(db, "users", result.user.uid), {
          email: result.user.email,
          role: "user",
          isAdmin: false,
          created_at: new Date().toISOString(),
        });
      }
      return { error: null };
    } catch (error) {
      return { error };
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setIsAdmin(false);
    try { localStorage.removeItem(ROLE_CACHE_KEY); } catch { /* */ }
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<{ error: any }> => {
    try {
      try { localStorage.removeItem(ROLE_CACHE_KEY); } catch { /* */ }
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      if (result.user.email && isBlockedEmail(result.user.email)) {
        await firebaseSignOut(auth);
        return { error: { code: 'auth/blocked', message: 'Account suspended' } };
      }
      const userDoc = await getDoc(doc(db, "users", result.user.uid));
      if (!userDoc.exists()) {
        await setDoc(doc(db, "users", result.user.uid), {
          email: result.user.email,
          role: "user",
          isAdmin: false,
          created_at: new Date().toISOString(),
        });
      }
      return { error: null };
    } catch (error) {
      return { error };
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, roleLoading, signIn, signUp, signOut, signInWithGoogle }}>
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
