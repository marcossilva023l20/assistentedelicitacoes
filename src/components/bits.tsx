"use client";

import { useEffect, useState } from "react";
import { formatBRL } from "@/lib/shared";

/* ------------------------------------------------------------------ */
/* CountUp + Money: valores animados                                   */
/* ------------------------------------------------------------------ */

function useCountUp(target: number | null, duration = 1100) {
  const [value, setValue] = useState(0);
  // Reinicia o contador quando o alvo some — padrão oficial de "ajustar estado na
  // renderização" (evita setState síncrono dentro do effect, que causa render em cascata).
  const [previousTarget, setPreviousTarget] = useState(target);
  if (previousTarget !== target) {
    setPreviousTarget(target);
    if (target == null) setValue(0);
  }
  useEffect(() => {
    if (target == null) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(target * (1 - Math.pow(1 - t, 4)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

export function Money({ value, className = "" }: { value: number | null; className?: string }) {
  const v = useCountUp(value);
  return <span className={`tabular-nums ${className}`}>{value == null ? "—" : formatBRL(v)}</span>;
}

export function CountUp({ value, className = "" }: { value: number; className?: string }) {
  const v = useCountUp(value, 700);
  return <span className={`tabular-nums ${className}`}>{Math.round(v)}</span>;
}

/* ------------------------------------------------------------------ */
/* SiteBadge: avatar com cores da loja                                 */
/* ------------------------------------------------------------------ */

const SITE_COLORS: [RegExp, string, string][] = [
  [/mercado\s*livre/i, "#FFE600", "#131313"],
  [/amazon/i, "#FF9900", "#131313"],
  [/magazine|magalu/i, "#0086FF", "#ffffff"],
  [/casas?\s*bahia/i, "#2E5BFF", "#ffffff"],
  [/shopee/i, "#EE4D2D", "#ffffff"],
  [/kabum/i, "#FF5A00", "#ffffff"],
  [/pichau/i, "#9B5CFF", "#ffffff"],
  [/americanas/i, "#E60014", "#ffffff"],
  [/shein/i, "#111111", "#ffffff"],
  [/carrefour/i, "#0A4CA6", "#ffffff"],
  [/ponto/i, "#FFD400", "#131313"],
  [/extra/i, "#14A04B", "#ffffff"],
  [/submarino/i, "#19B7FF", "#131313"],
  [/fast\s*shop/i, "#D6B25E", "#131313"],
  [/biscuit/i, "#F58220", "#131313"],
  [/kalunga/i, "#E30613", "#ffffff"],
  [/leroy/i, "#78BE20", "#131313"],
  [/madeira/i, "#FF6900", "#ffffff"],
  [/mobly/i, "#FF4B4B", "#ffffff"],
];

export function SiteBadge({ site, size = "md" }: { site: string; size?: "sm" | "md" }) {
  const hit = SITE_COLORS.find(([re]) => re.test(site));
  const bg = hit?.[1] ?? "#1c2b26";
  const fg = hit?.[2] ?? "#bff747";
  const initials = site.replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, "").trim().slice(0, 2).toUpperCase() || "??";
  const dim = size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-xs";
  return (
    <span
      title={site}
      className={`${dim} inline-flex shrink-0 select-none items-center justify-center rounded-xl font-mono font-bold tracking-tight shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]`}
      style={{ background: bg, color: fg }}
    >
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Chip de conformidade                                                */
/* ------------------------------------------------------------------ */

import { ShieldCheck, TriangleAlert } from "lucide-react";

export function ComplianceChip({
  compliant,
  score = 100,
  isSimilar = false,
  missingCount,
}: {
  compliant: boolean;
  score?: number;
  isSimilar?: boolean;
  missingCount: number;
}) {
  const pct = Math.max(5, Math.min(100, score));

  // esquema de cores por porcentagem
  const colorClass =
    pct >= 100
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : pct >= 75
        ? "border-lime-400/30 bg-lime-400/10 text-lime-300"
        : pct >= 50
          ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
          : "border-rose-400/30 bg-rose-400/10 text-rose-300";

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${colorClass}`}>
        {pct >= 100 ? (
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
        )}
        <span>{pct}% do edital</span>
        {missingCount > 0 && pct < 100 && (
          <span className="opacity-75">({missingCount} pend.)</span>
        )}
      </span>
      {isSimilar && (
        <span className="inline-flex items-center rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium text-sky-300">
          Similar / Equivalente
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Label de seção                                                      */
/* ------------------------------------------------------------------ */

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-volt/80">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-volt shadow-[0_0_12px_2px_rgba(191,247,71,0.6)]" />
      {children}
    </p>
  );
}
