import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, orderBy, where, doc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";

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
      // Fetch all profiles
      const profilesRef = collection(db, "profiles");
      const profilesQuery = query(profilesRef, orderBy("created_at", "desc"));
      const profilesSnapshot = await getDocs(profilesQuery);

      // Fetch all orders to calculate stats
      const ordersRef = collection(db, "orders");
      const ordersSnapshot = await getDocs(ordersRef);
      
      // Create a map of user orders
      const userOrdersMap = new Map<string, { 
        total_orders: number; 
        total_spent: number; 
        last_order_date?: string;
      }>();

      ordersSnapshot.forEach((doc) => {
        const order = doc.data();
        const userId = order.user_id;
        
        if (userId && order.payment_status === "paid") {
          const existing = userOrdersMap.get(userId) || { 
            total_orders: 0, 
            total_spent: 0,
            last_order_date: undefined
          };
          
          existing.total_orders += 1;
          existing.total_spent += Number(order.total_amount) || 0;
          
          const orderDate = order.created_at;
          if (!existing.last_order_date || orderDate > existing.last_order_date) {
            existing.last_order_date = orderDate;
          }
          
          userOrdersMap.set(userId, existing);
        }
      });

      // Map profiles to users with stats
      const users: FirebaseUser[] = profilesSnapshot.docs.map((doc) => {
        const profile = doc.data();
        const userId = doc.id;
        const orderStats = userOrdersMap.get(userId) || { 
          total_orders: 0, 
          total_spent: 0,
          last_order_date: undefined
        };

        return {
          id: userId,
          email: profile.email || "",
          created_at: profile.created_at || new Date().toISOString(),
          phone: profile.phone,
          full_name: profile.full_name,
          nickname: profile.nickname,
          avatar_url: profile.avatar_url,
          last_order_date: orderStats.last_order_date,
          total_orders: orderStats.total_orders,
          total_spent: orderStats.total_spent,
          balance: profile.balance || 0,
        };
      });

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
          created_at: data.created_at,
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

// Update user balance
export const updateUserBalance = async (userId: string, newBalance: number): Promise<void> => {
  const profileRef = doc(db, "profiles", userId);
  await updateDoc(profileRef, {
    balance: newBalance
  });
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
