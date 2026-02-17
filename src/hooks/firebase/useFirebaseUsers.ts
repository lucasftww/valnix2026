import { useQuery } from "@tanstack/react-query";
import { requireAdminToken } from "@/lib/adminAuth";
import { invokeFunction } from "@/lib/apiHelper";

// Convert Firestore Timestamp or string to ISO string
function toISOString(val: any): string {
  if (!val) return new Date().toISOString();
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

// Fetch all users via admin-data edge function
export const useAdminUsers = () => {
  return useQuery({
    queryKey: ["firebase-admin-users"],
    queryFn: async () => {
      const token = requireAdminToken();
      const response = await invokeFunction('admin-data', {
        method: 'GET',
        queryParams: { resource: 'users' },
        headers: { 'x-admin-token': token },
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Failed to fetch users' }));
        throw new Error(err.error || 'Failed to fetch users');
      }

      const data = await response.json();
      return (data.users || []).map((u: any) => ({
        ...u,
        created_at: toISOString(u.created_at),
        last_order_date: u.last_order_date ? toISOString(u.last_order_date) : undefined,
        total_orders: u.total_orders || 0,
        total_spent: u.total_spent || 0,
        balance: u.balance || 0,
      })) as FirebaseUser[];
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

// Fetch orders for a specific user
export const useUserOrders = (userId: string | null) => {
  return useQuery({
    queryKey: ["firebase-user-orders", userId],
    queryFn: async () => {
      if (!userId) return [];
      const token = requireAdminToken();
      const response = await invokeFunction('admin-data', {
        method: 'GET',
        queryParams: { resource: 'user-orders', userId },
        headers: { 'x-admin-token': token },
      });

      if (!response.ok) return [];
      const data = await response.json();
      return (data.orders || []).map((o: any) => ({
        id: o.id,
        created_at: toISOString(o.created_at),
        total_amount: Number(o.total_amount) || 0,
        status: o.status || "pending",
        payment_status: o.payment_status || "pending",
      })) as FirebaseOrder[];
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
      try {
        const token = requireAdminToken();
        const response = await invokeFunction('admin-data', {
          method: 'GET',
          queryParams: { resource: 'check-admin', userId },
          headers: { 'x-admin-token': token },
        });
        if (!response.ok) return false;
        const data = await response.json();
        return data.isAdmin === true;
      } catch {
        return false;
      }
    },
    enabled: !!userId,
  });
};

// Update user balance
export const updateUserBalance = async (userId: string, newBalance: number): Promise<void> => {
  const token = requireAdminToken();
  const response = await invokeFunction('admin-data', {
    method: 'PUT',
    queryParams: { resource: 'users' },
    headers: { 'x-admin-token': token },
    body: { id: userId, balance: newBalance },
  });
  if (!response.ok) throw new Error('Failed to update balance');
};

// Delete user
export const deleteFirebaseUser = async (userId: string): Promise<void> => {
  const token = requireAdminToken();
  const response = await invokeFunction('admin-data', {
    method: 'DELETE',
    queryParams: { resource: 'users', id: userId },
    headers: { 'x-admin-token': token },
  });
  if (!response.ok) throw new Error('Failed to delete user');
};
