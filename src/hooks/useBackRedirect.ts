import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Back Redirect: quando o usuário pressiona "voltar" no navegador,
 * redireciona para a URL especificada (preservando query params atuais).
 * Não interfere com F5/refresh — usa Navigation API quando disponível.
 */
export function useBackRedirect(redirectPath = "/") {
  const location = useLocation();
  const navigate = useNavigate();
  

  useEffect(() => {
    // Skip if already on the redirect target
    if (location.pathname === redirectPath) return;

    // Push a sentinel entry so "back" triggers popstate instead of leaving the app
    window.history.pushState({ __backRedirect: true }, "", window.location.href);

    const handlePopState = () => {
      navigate(redirectPath, { replace: true });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [location.pathname, navigate, redirectPath]);
}
