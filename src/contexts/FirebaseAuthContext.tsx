import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
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

  // Track if we've already reverted a rogue admin doc to avoid loops
  const revertedRef = useRef(new Set<string>());

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
          console.warn("🚫 Blocked UID detected, signing out:", firebaseUser.uid);
          await firebaseSignOut(auth);
          setUser(null);
          setIsAdmin(false);
          return;
        }

        // Block spam email patterns — auto sign out and skip ALL Firestore writes
        if (firebaseUser.email && (isBlockedEmail(firebaseUser.email) || isSpamEmailPattern(firebaseUser.email))) {
          console.warn("🚫 Spam/blocked email detected, signing out:", firebaseUser.email);
          await firebaseSignOut(auth);
          setUser(null);
          setIsAdmin(false);
          return;
        }

        // Skip Firestore doc creation for unverified emails to prevent quota drain attacks
        // The attacker creates accounts via direct API calls — those accounts won't have verified emails
        // BUT still check admin role so admin can access the panel
        const isUnverifiedPassword = !firebaseUser.emailVerified && firebaseUser.providerData?.[0]?.providerId === 'password';

        // ── Check admin role — use local cache first, then validate in background ──
        console.log("[Auth] Checking admin role for UID:", firebaseUser.uid, "Email:", firebaseUser.email);
        const cachedAdmin = getCachedRole(firebaseUser.uid);
        let hasAdminRole = cachedAdmin ?? false;

        // Fallback: check role via edge function when Firestore fails
        const checkRoleViaApi = async (uid: string): Promise<boolean> => {
          try {
            const baseUrl = import.meta.env.VITE_SUPABASE_URL;
            const res = await fetch(`${baseUrl}/functions/v1/site-data?type=check-role&uid=${uid}`, {
              headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
            });
            if (!res.ok) {
              console.warn("[Auth] API role check failed with status:", res.status);
              return false;
            }
            const data = await res.json();
            console.log("[Auth] API role check result:", data);
            return data.isAdmin === true;
          } catch (err) {
            console.warn("[Auth] API role check error:", err);
            return false;
          }
        };
        
        if (cachedAdmin !== null) {
          // Use cached value immediately for fast render
          if (alive) setIsAdmin(cachedAdmin);
          // Validate in background (non-blocking)
          getDoc(doc(db, "user_roles", firebaseUser.uid)).then((roleDoc) => {
            if (!alive) return;
            const serverAdmin = roleDoc.exists() && roleDoc.data()?.role === "admin";
            if (serverAdmin !== cachedAdmin) {
              setIsAdmin(serverAdmin);
              setCachedRole(firebaseUser.uid, serverAdmin);
            }
            hasAdminRole = serverAdmin;
          }).catch(async () => {
            // Firestore failed — try API fallback
            console.warn("[Auth] Firestore role check failed, trying API fallback");
            const apiAdmin = await checkRoleViaApi(firebaseUser.uid);
            if (!alive) return;
            if (apiAdmin !== cachedAdmin) {
              setIsAdmin(apiAdmin);
              setCachedRole(firebaseUser.uid, apiAdmin);
            }
            hasAdminRole = apiAdmin;
          });
        } else {
          // No cache — fetch with timeout, fallback to API
          try {
            const roleResult = await Promise.race([
              getDoc(doc(db, "user_roles", firebaseUser.uid)),
              new Promise<null>((r) => setTimeout(() => r(null), 3000)),
            ]);
            if (roleResult) {
              hasAdminRole = roleResult.exists?.() && roleResult.data()?.role === "admin";
              console.log("[Auth] Firestore role result:", hasAdminRole, "exists:", roleResult.exists?.(), "data:", roleResult.data());
            } else {
              // Timeout — try API fallback
              console.warn("[Auth] Firestore role check timed out, trying API fallback");
              hasAdminRole = await checkRoleViaApi(firebaseUser.uid);
              console.log("[Auth] API fallback admin result:", hasAdminRole);
            }
            if (alive) setIsAdmin(hasAdminRole);
            setCachedRole(firebaseUser.uid, hasAdminRole);
          } catch {
            // Firestore error — try API fallback
            console.warn("[Auth] Firestore role check error, trying API fallback");
            try {
              hasAdminRole = await checkRoleViaApi(firebaseUser.uid);
              if (alive) setIsAdmin(hasAdminRole);
              setCachedRole(firebaseUser.uid, hasAdminRole);
            } catch {
              setIsAdmin(false);
            }
          }
        }

          // Non-blocking: handle users/profile docs in background with heavy delay
          // Skip for unverified password accounts to prevent quota drain attacks
          if (!isUnverifiedPassword) {
            // This prevents competing with product data for Firestore quota
            setTimeout(() => {
              if (!alive) return;
              (async () => {
                try {
                  const [userDoc, profileDoc] = await Promise.all([
                    getDoc(doc(db, "users", firebaseUser.uid)),
                    getDoc(doc(db, "profiles", firebaseUser.uid)),
                  ]);

                  if (!alive) return;

                  if (userDoc.exists()) {
                    const userData = userDoc.data();
                    if ((userData?.role === "admin" || userData?.isAdmin === true) && !hasAdminRole) {
                      if (!revertedRef.current.has(firebaseUser.uid)) {
                        revertedRef.current.add(firebaseUser.uid);
                        console.warn("🚨 Unauthorized admin detected, reverting:", firebaseUser.uid);
                        try {
                          await setDoc(doc(db, "users", firebaseUser.uid), {
                            email: firebaseUser.email,
                            role: "user",
                            isAdmin: false,
                            created_at: userData.created_at || new Date().toISOString(),
                            flagged_at: new Date().toISOString(),
                            flagged_reason: "unauthorized_admin_revert",
                          });
                        } catch (revertErr) {
                          console.warn("Could not revert users doc (likely permissions):", revertErr);
                        }
                      }
                    }
                  } else if (alive) {
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
            }, 3000); // 3s delay to let product queries complete first
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
      // Security: NEVER allow signUp to create admin users
      // Only create Firestore docs if email is NOT spam (double check)
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
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      if (result.user.email && isBlockedEmail(result.user.email)) {
        await firebaseSignOut(auth);
        return { error: { code: 'auth/blocked', message: 'Account suspended' } };
      }
      const userDoc = await getDoc(doc(db, "users", result.user.uid));
      if (!userDoc.exists()) {
        // Security: NEVER allow Google login to create admin users
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
