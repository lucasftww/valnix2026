import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth, db } from "@/integrations/firebase/config";
import { doc, getDoc, setDoc } from "firebase/firestore";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<{ error: any }>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      // Set loading false IMMEDIATELY so UI renders without waiting for Firestore
      setLoading(false);
      
      if (firebaseUser) {
        // Background: check admin + create profile (non-blocking)
        try {
          const [userDoc, profileDoc] = await Promise.all([
            getDoc(doc(db, "users", firebaseUser.uid)),
            getDoc(doc(db, "profiles", firebaseUser.uid)),
          ]);

          const ALLOWED_ADMIN_EMAILS = ["valnix@gmail.com"];
          if (userDoc.exists()) {
            const isRoleAdmin = userDoc.data()?.role === "admin";
            const isAllowedEmail = ALLOWED_ADMIN_EMAILS.includes(firebaseUser.email?.toLowerCase() || "");
            setIsAdmin(isRoleAdmin && isAllowedEmail);
          } else {
            await setDoc(doc(db, "users", firebaseUser.uid), {
              email: firebaseUser.email,
              role: "user",
              created_at: new Date().toISOString(),
            });
            setIsAdmin(false);
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
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return { error: null };
    } catch (error) {
      return { error };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<{ error: any }> => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", result.user.uid), {
        email: result.user.email,
        role: "user",
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
      const userDoc = await getDoc(doc(db, "users", result.user.uid));
      if (!userDoc.exists()) {
        await setDoc(doc(db, "users", result.user.uid), {
          email: result.user.email,
          role: "user",
          created_at: new Date().toISOString(),
        });
      }
      return { error: null };
    } catch (error) {
      return { error };
    }
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, signIn, signUp, signOut, signInWithGoogle, resetPassword }}>
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
