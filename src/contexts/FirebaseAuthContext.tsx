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
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // ── Cached role check with TTL (avoids Firestore read every page load) ──
  const ROLE_CACHE_KEY = 'valnix_role_cache_v1';
  const ROLE_CACHE_TTL = 10 * 60 * 1000; // 10 min

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

  useEffect(() => {
    let alive = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!alive) return;
      setUser(firebaseUser);
      setLoading(false);
      
      if (firebaseUser) {
        // Block banned UIDs immediately
        if (isBlockedUid(firebaseUser.uid)) {
          await firebaseSignOut(auth);
          setUser(null);
          setIsAdmin(false);
          return;
        }

        // Block spam email patterns — auto sign out
        if (firebaseUser.email && (isBlockedEmail(firebaseUser.email) || isSpamEmailPattern(firebaseUser.email))) {
          await firebaseSignOut(auth);
          setUser(null);
          setIsAdmin(false);
          return;
        }

        const isUnverifiedPassword = !firebaseUser.emailVerified && firebaseUser.providerData?.[0]?.providerId === 'password';

        // ── Check admin role via user_roles collection (source of truth) ──
        // Race: Firestore SDK vs API fallback — first to respond wins
        const cachedAdmin = getCachedRole(firebaseUser.uid);

        // Fallback: check role via edge function when Firestore fails
        const checkRoleViaApi = async (uid: string): Promise<boolean> => {
          try {
            const baseUrl = import.meta.env.VITE_SUPABASE_URL;
            const res = await fetch(`${baseUrl}/functions/v1/site-data?type=check-role&uid=${uid}`, {
              headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
            });
            if (!res.ok) return false;
            const data = await res.json();
            return data.isAdmin === true;
          } catch {
            return false;
          }
        };

        // Check role via Firestore with 3s timeout
        const checkRoleViaFirestore = async (uid: string): Promise<boolean> => {
          const roleResult = await Promise.race([
            getDoc(doc(db, "user_roles", uid)),
            new Promise<null>((r) => setTimeout(() => r(null), 3000)),
          ]);
          if (!roleResult) return false; // timeout
          return roleResult.exists?.() && roleResult.data()?.role === "admin";
        };
        
        if (cachedAdmin !== null) {
          // Use cached value immediately for fast render
          if (alive) setIsAdmin(cachedAdmin);
          // Validate in background via race (non-blocking)
          (async () => {
            let firestoreResult: boolean | null = null;
            let apiResult: boolean | null = null;

            const fsFetch = checkRoleViaFirestore(firebaseUser.uid)
              .then(r => { firestoreResult = r; return r; })
              .catch(() => null);
            const apiFetch = checkRoleViaApi(firebaseUser.uid)
              .then(r => { apiResult = r; return r; })
              .catch(() => null);

            const first = await Promise.race([fsFetch, apiFetch]);
            const serverAdmin = first ?? false;

            if (!alive) return;
            if (serverAdmin !== cachedAdmin) {
              setIsAdmin(serverAdmin);
              setCachedRole(firebaseUser.uid, serverAdmin);
            }

            // If first was false, wait for the other in case it returns true
            if (!serverAdmin) {
              await Promise.allSettled([fsFetch, apiFetch]);
              const finalAdmin = firestoreResult === true || apiResult === true;
              if (finalAdmin !== cachedAdmin && alive) {
                setIsAdmin(finalAdmin);
                setCachedRole(firebaseUser.uid, finalAdmin);
              }
            }
          })();
        } else {
          // No cache — race Firestore and API simultaneously
          let firestoreResult: boolean | null = null;
          let apiResult: boolean | null = null;

          const fsFetch = checkRoleViaFirestore(firebaseUser.uid)
            .then(r => { firestoreResult = r; return r; })
            .catch(() => null);
          const apiFetch = checkRoleViaApi(firebaseUser.uid)
            .then(r => { apiResult = r; return r; })
            .catch(() => null);

          const first = await Promise.race([fsFetch, apiFetch]);
          let hasAdminRole = first === true;

          // If first was false/null, wait for the other
          if (!hasAdminRole) {
            await Promise.allSettled([fsFetch, apiFetch]);
            hasAdminRole = firestoreResult === true || apiResult === true;
          }

          if (alive) setIsAdmin(hasAdminRole);
          setCachedRole(firebaseUser.uid, hasAdminRole);
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

                // Create user doc if it doesn't exist
                if (!userDoc.exists()) {
                  await setDoc(doc(db, "users", firebaseUser.uid), {
                    email: firebaseUser.email,
                    role: "user",
                    isAdmin: false,
                    created_at: new Date().toISOString(),
                  });
                }

                if (!alive) return;

                // Create profile doc if it doesn't exist
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
      } else {
        setIsAdmin(false);
      }
    });

    return () => { alive = false; unsubscribe(); };
  }, [getCachedRole, setCachedRole]);

  const signIn = useCallback(async (email: string, password: string): Promise<{ error: any }> => {
    if (isBlockedEmail(email)) {
      return { error: { code: 'auth/blocked', message: 'Account suspended' } };
    }
    try {
      // Clear cached role before login to force fresh check
      try { localStorage.removeItem('valnix_role_cache_v1'); } catch { /* */ }
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
      // Clear cached role before login to force fresh check
      try { localStorage.removeItem('valnix_role_cache_v1'); } catch { /* */ }
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
    <AuthContext.Provider value={{ user, loading, isAdmin, signIn, signUp, signOut, signInWithGoogle }}>
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
