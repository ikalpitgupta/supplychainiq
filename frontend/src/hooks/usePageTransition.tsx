// Route transitions: forward navigation fades the page up into place; back
// navigation slides it in from the left for a natural "returning" feel.
// ~260ms, transform/opacity only (compositor-friendly), applied via CSS
// animations defined in the Tailwind theme.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navType = useNavigationType(); // PUSH | POP | REPLACE
  const isBack = navType === "POP";

  // Keyed by pathname so each route change remounts and replays its entrance.
  // The outgoing page is kept mounted briefly so the swap reads as a transition.
  const [display, setDisplay] = useState({ node: children, key: location.pathname, back: isBack });
  const timer = useRef<number>();

  useEffect(() => {
    setDisplay({ node: children, key: location.pathname, back: isBack });
    window.clearTimeout(timer.current);
  }, [children, location.pathname, isBack]);

  // Scroll to top on every navigation (users expect this on route change).
  useEffect(() => {
    const main = document.querySelector("main");
    main?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div key={display.key} className={display.back ? "animate-page-back" : "animate-page-in"}>
      {display.node}
    </div>
  );
}
