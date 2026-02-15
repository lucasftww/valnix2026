import { memo } from "react";

// Simplified PageTransition — instant render, no exit delay
// Previous 150ms exit animation was adding perceived latency on every navigation
const PageTransition = memo(({ children }: { children: React.ReactNode }) => {
  return (
    <>{children}</>
  
  );
});

PageTransition.displayName = 'PageTransition';

export default PageTransition;
