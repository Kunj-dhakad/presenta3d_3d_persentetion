"use client";

import { motion, useReducedMotion } from "motion/react";

/** Decorative layered backdrop: stacked translucent layers drifting slowly. */
export function Hero() {
  const reduce = useReducedMotion();
  const layers = [0, 1, 2, 3, 4];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 grid-dots mask-[radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div className="absolute left-1/2 top-[58%] h-130 w-225 -translate-x-1/2 -translate-y-1/2 perspective-[1400px]">
        {layers.map((i) => (
          <motion.div
            key={i}
            className="absolute inset-x-[12%] h-45 rounded-[28px] border border-white/6"
            style={{
              top: 80 + i * 56,
              background: `linear-gradient(120deg, oklch(0.7 0.12 ${270 + i * 8} / ${0.1 - i * 0.012}), transparent 70%)`,
              rotateX: 62,
              transformPerspective: 1400,
            }}
            initial={{ opacity: 0, y: 30 }}
            animate={reduce ? { opacity: 1, y: 0 } : { opacity: 1, y: [0, -8, 0] }}
            transition={reduce ? { duration: 0.6 } : { opacity: { duration: 0.8, delay: i * 0.08 }, y: { duration: 7 + i, repeat: Infinity, ease: "easeInOut", delay: i * 0.4 } }}
          />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-background to-transparent" />
    </div>
  );
}
