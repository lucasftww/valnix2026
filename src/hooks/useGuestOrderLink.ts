import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * On login/signup, checks for unlinked guest orders matching user email
 * and offers to link them.
 */
export function useGuestOrderLinking(userId: string | undefined, userEmail: string | undefined) {
  const [pendingOrders, setPendingOrders] = useState<Array<{ id: string; order_id: string; hash: string }>>([]);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!userId || !userEmail) return;
    
    // Only check once per session
    const sessionKey = `valnix_guest_link_checked_${userId}`;
    if (sessionStorage.getItem(sessionKey)) {
      setChecked(true);
      return;
    }

    const checkPending = async () => {
      try {
        const { data, error } = await supabase
          .from("guest_orders")
          .select("id, order_id, hash")
          .eq("email", userEmail.toLowerCase())
          .eq("linked", false);

        if (!error && data && data.length > 0) {
          setPendingOrders(data);
        }
      } catch (err) {
        console.error("Error checking guest orders:", err);
      } finally {
        setChecked(true);
        sessionStorage.setItem(sessionKey, "true");
      }
    };

    checkPending();
  }, [userId, userEmail]);

  const linkOrders = async () => {
    if (!userId || pendingOrders.length === 0) return;

    try {
      for (const order of pendingOrders) {
        await supabase
          .from("guest_orders")
          .update({ linked: true, user_id: userId })
          .eq("id", order.id);
      }
      setPendingOrders([]);
      return true;
    } catch (err) {
      console.error("Error linking guest orders:", err);
      return false;
    }
  };

  const dismissLinking = () => {
    setPendingOrders([]);
  };

  return { pendingOrders, checked, linkOrders, dismissLinking };
}
