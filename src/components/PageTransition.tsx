import { memo } from "react";

// Simplified PageTransition — instant render, no exit delay
// Previous 150ms exit animation was adding perceived latency on every navigation
const PageTransition = memo(({ children }: { children: React.ReactNode }) => {
  return (
    <div className="animate-fade-in" style={{ animationDuration: '150ms' }}>
      {children}
    </div>
  );
});

PageTransition.displayName = 'PageTransition';

export default PageTransition;
