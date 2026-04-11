import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// premium_benefits was deactivated — redirect to the first active upsell.
// Preserva query string (ex.: order_id, hash, utm_*) igual ao redirect pós-compra.
export default function PainelPagar() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    navigate(`/entrega-prioritaria?${params.toString()}`, { replace: true });
  }, [navigate, searchParams]);

  return null;
}
