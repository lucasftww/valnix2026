import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * On login/signup, AUTOMATICALLY links guest orders by email.
 * Returns the count of linked orders for an informational banner (no user action needed).
 */
export function useGuestOrderLinking(userId: string | undefined, userEmail: string | undefined) {
  const [linkedCount, setLinkedCount] = useState(0);
  const [linkedHashes, setLinkedHashes] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!userId || !userEmail) return;
    
    // Only run once per session per user
    const sessionKey = `valnix_guest_linked_${userId}`;
    if (sessionStorage.getItem(sessionKey)) {
      setChecked(true);
      return;
    }

    const autoLink = async () => {
      try {
        // Find unlinked guest orders for this email
        const { data, error } = await supabase
          .from("guest_orders")
          .select("id, order_id, hash")
          .eq("email", userEmail.toLowerCase())
          .eq("linked", false);

        if (error || !data || data.length === 0) {
          setChecked(true);
          sessionStorage.setItem(sessionKey, "true");
          return;
        }

        // AUTO-LINK all of them immediately (no user action needed)
        for (const order of data) {
          await supabase
            .from("guest_orders")
            .update({ linked: true, user_id: userId })
            .eq("id", order.id);
        }

        console.log(`✅ Auto-linked ${data.length} guest order(s) for ${userEmail}`);
        setLinkedCount(data.length);
        setLinkedHashes(data.map(o => o.hash));
      } catch (err) {
        console.error("Error auto-linking guest orders:", err);
      } finally {
        setChecked(true);
        sessionStorage.setItem(sessionKey, "true");
      }
    };

    autoLink();
  }, [userId, userEmail]);

  const dismiss = () => {
    setLinkedCount(0);
    setLinkedHashes([]);
  };

  return { linkedCount, linkedHashes, checked, dismiss };
}
