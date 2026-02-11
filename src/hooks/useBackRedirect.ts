import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Back Redirect: quando o usuário pressiona "voltar" no navegador,
 * redireciona para a URL especificada (preservando query params atuais).
 */
export function useBackRedirect(redirectPath = "/") {
  const location = useLocation();

  useEffect(() => {
    // Build full redirect URL preserving current search params
    const currentParams = location.search.replace("?", "");
    const separator = redirectPath.includes("?") ? "&" : "?";
    const fullUrl =
      window.location.origin +
      redirectPath +
      (currentParams ? separator + currentParams : "");

    // Push extra history entries so "back" triggers popstate
    history.pushState({}, "", location.pathname + location.search);
    history.pushState({}, "", location.pathname + location.search);
    history.pushState({}, "", location.pathname + location.search);

    const handlePopState = () => {
      setTimeout(() => {
        window.location.href = fullUrl;
      }, 1);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [location.pathname]); // Re-run on route change
}
