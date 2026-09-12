// SupplyChainIQ brand lockup — solid ink tile with the cube mark. Minimal,
// enterprise: no glow or shine by default (kept as optional props).
import { Boxes } from "lucide-react";

const SIZES = {
  md: { tile: "h-10 w-10 rounded-2xl", icon: "h-5 w-5", text: "text-lg" },
  lg: { tile: "h-11 w-11 rounded-2xl", icon: "h-5 w-5", text: "text-2xl" },
} as const;

export function LogoMark({ size = "md", shine = false, tagline }: {
  size?: keyof typeof SIZES;
  shine?: boolean;
  tagline?: string;
}) {
  const s = SIZES[size];
  return (
    <div className="flex items-center gap-3">
      {/* Solid brand tile */}
      <span
        className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-chrome text-white ${s.tile}`}
        aria-hidden
      >
        <Boxes className={`relative z-10 ${s.icon}`} strokeWidth={2.2} />
        {shine && (
          <span
            className="animate-logo-shine pointer-events-none absolute inset-y-0 left-0 z-20 w-1/3 bg-gradient-to-r from-transparent via-white/60 to-transparent"
            aria-hidden
          />
        )}
      </span>

      <div className="leading-none">
        <p className={`font-display font-semibold tracking-tight text-white ${s.text}`}>
          SupplyChain<span className="text-lime-300">IQ</span>
        </p>
        {tagline && (
          <p className="mt-1 text-[9px] uppercase leading-relaxed tracking-[0.14em] text-white/40">{tagline}</p>
        )}
      </div>
    </div>
  );
}
