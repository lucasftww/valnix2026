import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "@/contexts/CartContext";

const Cart = () => {
  const { items } = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    // Redireciona para checkout se tiver itens, senão para home
    if (items.length > 0) {
      navigate("/checkout", { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [items.length, navigate]);

  return null;
};

export default Cart;
