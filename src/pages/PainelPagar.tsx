import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// premium_benefits was deactivated — redirect to the first active upsell
export default function PainelPagar() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    navigate(`/painel-pagar-entrega?${params.toString()}`, { replace: true });
  }, [navigate, searchParams]);

  return null;
}
