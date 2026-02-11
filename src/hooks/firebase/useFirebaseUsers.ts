import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, orderBy, where, doc, getDoc, updateDoc, deleteDoc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";

// Convert Firestore Timestamp or string to ISO string
function toISOString(val: any): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'object' && 'seconds' in val) return new Date(val.seconds * 1000).toISOString();
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? new Date().toISOString() : val;
  }
  return new Date().toISOString();
}

export interface FirebaseUser {
  id: string;
  email: string;
  created_at: string;
  phone?: string;
  full_name?: string;
  nickname?: string;
  avatar_url?: string;
  last_order_date?: string;
  total_orders: number;
  total_spent: number;
  balance: number;
}

export interface FirebaseOrder {
  id: string;
  created_at: string;
  total_amount: number;
  status: string;
  payment_status: string;
}

// Fetch all users with their order statistics
export const useAdminUsers = () => {
  return useQuery({
    queryKey: ["firebase-admin-users"],
    queryFn: async () => {
      // Fetch from both collections to catch all users
      // Use Promise.allSettled to avoid crash if one collection has permission issues
      const [profilesResult, usersResult, ordersResult] = await Promise.allSettled([
        getDocs(query(collection(db, "profiles"), orderBy("created_at", "desc"))),
        getDocs(collection(db, "users")),
        getDocs(collection(db, "orders")),
      ]);

      const profilesSnapshot = profilesResult.status === "fulfilled" ? profilesResult.value : null;
      const usersSnapshot = usersResult.status === "fulfilled" ? usersResult.value : null;
      const ordersSnapshot = ordersResult.status === "fulfilled" ? ordersResult.value : null;

      if (!profilesSnapshot && !usersSnapshot) {
        console.warn("Could not fetch users from any collection");
        return [];
      }

      // Create a map of user orders
      const userOrdersMap = new Map<string, { 
        total_orders: number; 
        total_spent: number; 
        last_order_date?: string;
      }>();

      ordersSnapshot?.forEach((d) => {
        const order = d.data();
        const userId = order.user_id;
        
        if (userId && order.payment_status === "paid") {
          const existing = userOrdersMap.get(userId) || { 
            total_orders: 0, 
            total_spent: 0,
            last_order_date: undefined
          };
          
          existing.total_orders += 1;
          existing.total_spent += Number(order.total_amount) || 0;
          
          const orderDate = toISOString(order.created_at);
          if (!existing.last_order_date || orderDate > existing.last_order_date) {
            existing.last_order_date = orderDate;
          }
          
          userOrdersMap.set(userId, existing);
        }
      });

      // Build user map from profiles first
      const userMap = new Map<string, FirebaseUser>();

      profilesSnapshot?.docs.forEach((d) => {
        const profile = d.data();
        const userId = d.id;
        const orderStats = userOrdersMap.get(userId) || { total_orders: 0, total_spent: 0 };

        userMap.set(userId, {
          id: userId,
          email: profile.email || "",
          created_at: toISOString(profile.created_at),
          phone: profile.phone,
          full_name: profile.full_name,
          nickname: profile.nickname,
          avatar_url: profile.avatar_url,
          last_order_date: orderStats.last_order_date,
          total_orders: orderStats.total_orders,
          total_spent: orderStats.total_spent,
          balance: profile.balance || 0,
        });
      });

      // Add users from "users" collection that don't have a profile yet
      usersSnapshot?.docs.forEach((d) => {
        const userId = d.id;
        if (!userMap.has(userId)) {
          const userData = d.data();
          const orderStats = userOrdersMap.get(userId) || { total_orders: 0, total_spent: 0 };

          userMap.set(userId, {
            id: userId,
            email: userData.email || "",
            created_at: toISOString(userData.created_at),
            phone: undefined,
            full_name: undefined,
            nickname: undefined,
            avatar_url: undefined,
            last_order_date: orderStats.last_order_date,
            total_orders: orderStats.total_orders,
            total_spent: orderStats.total_spent,
            balance: 0,
          });
        }
      });

      // Sort by created_at descending
      const users = Array.from(userMap.values());
      users.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return users;
    },
  });
};

// Fetch orders for a specific user
export const useUserOrders = (userId: string | null) => {
  return useQuery({
    queryKey: ["firebase-user-orders", userId],
    queryFn: async () => {
      if (!userId) return [];
      
      const ordersRef = collection(db, "orders");
      const ordersQuery = query(
        ordersRef, 
        where("user_id", "==", userId),
        orderBy("created_at", "desc")
      );
      
      const snapshot = await getDocs(ordersQuery);
      
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          created_at: toISOString(data.created_at),
          total_amount: Number(data.total_amount) || 0,
          status: data.status || "pending",
          payment_status: data.payment_status || "pending",
        } as FirebaseOrder;
      }).slice(0, 10); // Limit to 10 orders
    },
    enabled: !!userId,
  });
};

// Check if user is admin
export const useIsUserAdmin = (userId: string | null) => {
  return useQuery({
    queryKey: ["firebase-user-admin", userId],
    queryFn: async () => {
      if (!userId) return false;
      
      const roleDoc = await getDoc(doc(db, "user_roles", userId));
      if (roleDoc.exists()) {
        return roleDoc.data()?.role === "admin";
      }
      return false;
    },
    enabled: !!userId,
  });
};

// Update user balance - uses setDoc with merge to create doc if it doesn't exist
export const updateUserBalance = async (userId: string, newBalance: number): Promise<void> => {
  const profileRef = doc(db, "profiles", userId);
  await setDoc(profileRef, {
    balance: newBalance
  }, { merge: true });
};

// Delete user from Firestore (profiles and user_roles collections)
export const deleteFirebaseUser = async (userId: string): Promise<void> => {
  // Delete profile
  const profileRef = doc(db, "profiles", userId);
  await deleteDoc(profileRef);
  
  // Delete user role if exists
  const roleRef = doc(db, "user_roles", userId);
  const roleDoc = await getDoc(roleRef);
  if (roleDoc.exists()) {
    await deleteDoc(roleRef);
  }
};
