// Motion system: staggered entrances, count-up numbers, reveal lists — all
// gated behind prefers-reduced-motion. Timing rules: 150-500ms per element,
// small stagger offsets, transform/opacity only (compositor-friendly).
import { motion, useInView, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export { motion, AnimatePresence, useReducedMotion } from "framer-motion";

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fade-and-rise entrance used by cards, rows, and blocks. */
export const riseIn = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3, ease: EASE },
};

/** Fade-and-slide from the left (lists, insights). */
export const slideInLeft = {
  initial: { opacity: 0, x: -18 },
  animate: { opacity: 1, x: 0 },
  transition: { duration: 0.3, ease: EASE },
};

/** Container that staggers its children by `stagger` seconds. */
export function Stagger({ children, className, stagger = 0.06, delay = 0 }: {
  children: ReactNode; className?: string; stagger?: number; delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: reduce ? 0 : stagger, delayChildren: reduce ? 0 : delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Child of <Stagger>: fades and rises into place. */
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={{
        hidden: reduce ? {} : { opacity: 0, y: 14 },
        show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** Count-up number. Animates on mount and whenever `value` changes; respects
 *  reduced motion by jumping straight to the final value. */
export function AnimatedNumber({ value, format, className, ariaLabel }: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  ariaLabel?: string;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 60, damping: 20, mass: 0.8 });
  const [display, setDisplay] = useState(() => (reduce ? value : 0));
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });

  useEffect(() => {
    if (reduce) { setDisplay(value); return; }
    if (inView) mv.set(value);
  }, [inView, value, mv, reduce]);

  useEffect(() => {
    const unsub = spring.on("change", (v) => setDisplay(v));
    return unsub;
  }, [spring]);

  return (
    <span ref={ref} className={className} aria-label={ariaLabel} role="text">
      {format ? format(display) : Math.round(display).toLocaleString("en-IN")}
    </span>
  );
}

/** Sequentially reveals children (one-by-one) — used for the insights list. */
export function Reveal({ items, render, className, interval = 0.12 }: {
  items: unknown[];
  render: (item: unknown, index: number) => ReactNode;
  className?: string;
  interval?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <div className={className}>
      {items.map((item, i) => (
        <motion.div
          key={i}
          initial={reduce ? false : { opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: reduce ? 0 : 0.15 + i * interval, duration: 0.25, ease: EASE }}
        >
          {render(item, i)}
        </motion.div>
      ))}
    </div>
  );
}

/** Draw-in line for SVG paths (forecast line reveal). */
export function DrawLine({ children, delay = 0, duration = 0.9 }: {
  children: ReactNode; delay?: number; duration?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.g
      initial={reduce ? false : { pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ delay: reduce ? 0 : delay, duration: reduce ? 0 : duration, ease: EASE }}
    >
      {children}
    </motion.g>
  );
}
