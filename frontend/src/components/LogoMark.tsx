// SupplyChainIQ brand lockup — glowing blue tile with the cube mark and a
// subtle animated shine sweep for a premium feel.
import { Boxes } from "lucide-react";

const SIZES = {
  md: { tile: "h-10 w-10 rounded-2xl", icon: "h-5 w-5", text: "text-lg" },
  lg: { tile: "h-11 w-11 rounded-2xl", icon: "h-5 w-5", text: "text-2xl" },
} as const;

export function LogoMark({ size = "md", glow = true, shine = true, tagline }: {
  size?: keyof typeof SIZES;
  glow?: boolean;
  shine?: boolean;
  tagline?: string;
}) {
  const s = SIZES[size];
  return (
    <div className="flex items-center gap-3">
      {/* Glowing tile with the periodic shine sweep */}
      <span
        className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-blue-600 text-white ${s.tile} ${
          glow ? "shadow-[0_0_24px_rgba(37,99,235,0.6)]" : ""
        }`}
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
          SupplyChain<span className="text-blue-400">IQ</span>
        </p>
        {tagline && (
          <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/40">{tagline}</p>
        )}
      </div>
    </div>
  );
}
