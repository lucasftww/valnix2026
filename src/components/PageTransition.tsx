import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const PageTransition = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [transitionState, setTransitionState] = useState<"enter" | "exit">("enter");

  useEffect(() => {
    if (children !== displayChildren) {
      setTransitionState("exit");
      const timeout = setTimeout(() => {
        setDisplayChildren(children);
        setTransitionState("enter");
      }, 150);
      return () => clearTimeout(timeout);
    }
  }, [children, location.pathname]);

  return (
    <div
      className={`transition-opacity duration-200 ease-out ${
        transitionState === "enter"
          ? "opacity-100"
          : "opacity-0"
      }`}
    >
      {displayChildren}
    </div>
  );
};

export default PageTransition;
