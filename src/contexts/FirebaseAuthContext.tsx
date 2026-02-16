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
import { isBlockedEmail, isBlockedUid } from "@/lib/blockedEmails";

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      
      if (firebaseUser) {
        // Block banned UIDs immediately
        if (isBlockedUid(firebaseUser.uid)) {
          await firebaseSignOut(auth);
          setIsAdmin(false);
          return;
        }

        try {
          // ── SECURITY: Check admin ONLY from user_roles collection ──
          // user_roles is write-protected by Firestore Rules (only admin can write)
          // The "users" collection is NOT trusted for role checks
          const [roleDoc, userDoc, profileDoc] = await Promise.all([
            getDoc(doc(db, "user_roles", firebaseUser.uid)),
            getDoc(doc(db, "users", firebaseUser.uid)),
            getDoc(doc(db, "profiles", firebaseUser.uid)),
          ]);

          const hasAdminRole = roleDoc.exists() && roleDoc.data()?.role === "admin";
          setIsAdmin(hasAdminRole);

          // ── AUTO-REVERT: If users doc claims admin but user_roles says no ──
          // This catches privilege escalation attempts
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
                  console.error("Failed to revert rogue admin doc:", revertErr);
                }
              }
            }
          } else {
            // New user — create users doc (non-admin)
            await setDoc(doc(db, "users", firebaseUser.uid), {
              email: firebaseUser.email,
              role: "user",
              isAdmin: false,
              created_at: new Date().toISOString(),
            });
          }

          if (!profileDoc.exists()) {
            await setDoc(doc(db, "profiles", firebaseUser.uid), {
              email: firebaseUser.email,
              full_name: firebaseUser.displayName || null,
              balance: 0,
              created_at: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error("Error checking admin status:", error);
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
    });

    return () => unsubscribe();
  }, []);

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
    if (isBlockedEmail(email)) {
      return { error: { code: 'auth/blocked', message: 'Account suspended' } };
    }
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      // Security: NEVER allow signUp to create admin users
      await setDoc(doc(db, "users", result.user.uid), {
        email: result.user.email,
        role: "user",
        isAdmin: false,
        created_at: new Date().toISOString(),
      });
      return { error: null };
    } catch (error) {
      return { error };
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setIsAdmin(false);
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<{ error: any }> => {
    try {
      const provider = new GoogleAuthProvider();
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
