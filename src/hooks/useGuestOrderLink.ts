import { useEffect, useState } from "react";
import { db } from "@/integrations/firebase/config";
import { collection, getDocs, updateDoc, query, where, doc } from "firebase/firestore";

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
        const guestOrdersRef = collection(db, "guest_orders");
        const q = query(
          guestOrdersRef,
          where("email", "==", userEmail.toLowerCase()),
          where("linked", "==", false)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          setChecked(true);
          sessionStorage.setItem(sessionKey, "true");
          return;
        }

        // AUTO-LINK all of them immediately (no user action needed)
        const linkedOrderIds: string[] = [];
        for (const guestDoc of snapshot.docs) {
          await updateDoc(guestDoc.ref, { linked: true, user_id: userId });
          const orderId = guestDoc.data().order_id;
          if (orderId) linkedOrderIds.push(orderId);
        }

        // Also update the orders collection so they appear in "Meus Pedidos"
        for (const orderId of linkedOrderIds) {
          try {
            const orderRef = doc(db, "orders", orderId);
            await updateDoc(orderRef, { user_id: userId });
          } catch (err) {
            console.warn(`⚠️ Could not update order ${orderId} user_id:`, err);
          }
        }

        console.log(`✅ Auto-linked ${snapshot.size} guest order(s) for ${userEmail}`);
        setLinkedCount(snapshot.size);
        setLinkedHashes(snapshot.docs.map(d => d.data().hash));
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
