"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  TimerReset,
  TriangleAlert,
} from "lucide-react";
import { ComplianceChip, Eyebrow, Money, SiteBadge } from "@/components/bits";
import { formatBRL, formatDateBR, type SearchDetail } from "@/lib/shared";

export type Phase = "idle" | "loading" | "done" | "error";
export interface PanelError {
  message: string;
  code?: "MISSING_KEY" | "QUOTA" | string;
}

/* ------------------------------------------------------------------ */
/* Estado: carregando                                                  */
/* ------------------------------------------------------------------ */

const STEPS = [
  { at: 0.5, label: "Extraindo requisitos obrigatórios do edital" },
  { at: 4, label: "Varrendo buscadores e os maiores marketplaces do Brasil" },
  { at: 14, label: "Confirmando preços reais nas páginas das lojas" },
  { at: 26, label: "Validando conformidade com 100% das especificações" },
  { at: 40, label: "Ordenando ofertas do menor ao maior preço" },
];

function LoadingState() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const t = setInterval(() => setElapsed((performance.now() - started) / 1000), 200);
    return () => clearInterval(t);
  }, []);
  const pct = Math.min(96, 100 * (1 - Math.exp(-elapsed / 16)));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex min-h-[560px] flex-col items-center justify-center px-6 py-16 text-center"
    >
      <div className="relative mb-10 h-28 w-28">
        <div className="radar-ring absolute inset-0 animate-spin-slow rounded-full blur-[1px]" />
        <div className="absolute inset-[3px] rounded-full bg-ink" />
        <div className="absolute inset-0 animate-ping rounded-full border border-volt/20 [animation-duration:2.2s]" />
        <div className="absolute inset-5 rounded-full border border-volt/25" />
        <div className="absolute inset-0 flex items-center justify-center">
          <ScanSearch className="h-9 w-9 text-volt" />
        </div>
      </div>

      <h3 className="font-display text-xl font-semibold text-white">Buscando na web em tempo real</h3>
      <p className="mt-1 text-sm text-mist">
        A IA está pesquisando anúncios reais agora — pode levar até ~90 segundos.
      </p>

      <div className="mt-8 w-full max-w-md">
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-gradient-to-r from-volt/50 to-volt transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="mt-6 space-y-3 text-left">
          {STEPS.map((s, i) => {
            const nextAt = STEPS[i + 1]?.at ?? Infinity;
            const done = elapsed >= nextAt;
            const active = !done && elapsed >= s.at;
            return (
              <li key={s.label} className="flex items-center gap-3 text-sm">
                {done ? (
                  <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-volt" />
                ) : active ? (
                  <Loader2 className="h-4.5 w-4.5 shrink-0 animate-spin text-volt/80" />
                ) : (
                  <span className="h-4.5 w-4.5 shrink-0 rounded-full border border-white/15" />
                )}
                <span className={done ? "text-white/85" : active ? "text-volt/90" : "text-white/35"}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Estado: vazio                                                       */
/* ------------------------------------------------------------------ */

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex min-h-[560px] flex-col items-center justify-center px-6 py-14 text-center"
    >
      <div className="relative">
        <div className="absolute inset-0 -z-10 scale-125 rounded-full bg-volt/10 blur-3xl" />
        <Image
          src="/images/empty-scan.png"
          alt="Lupa analisando documentos de edital"
          width={380}
          height={380}
          className="mx-auto w-64 rounded-3xl border border-white/10 object-cover shadow-2xl shadow-black/60 sm:w-72"
          priority
        />
      </div>
      <h3 className="mt-8 max-w-md font-display text-2xl font-semibold leading-snug text-white">
        Cole o item do edital e descubra <span className="text-volt">quem vende mais barato</span>
      </h3>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-mist">
        A IA identifica os requisitos obrigatórios, pesquisa nos maiores marketplaces do Brasil e só
        traz ofertas que atendem 100% das especificações — com link direto e média de preços.
      </p>
      <div className="mt-8 grid w-full max-w-md grid-cols-3 gap-2 text-center">
        {[
          ["01", "Cole o edital"],
          ["02", "IA busca na web"],
          ["03", "Compare e economize"],
        ].map(([n, label]) => (
          <div key={n} className="glass rounded-xl px-2 py-3">
            <p className="font-mono text-[11px] text-volt">{n}</p>
            <p className="mt-1 text-[11px] leading-tight text-white/70">{label}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Estado: erro                                                        */
/* ------------------------------------------------------------------ */

function ErrorState({ error, onReset }: { error: PanelError; onReset: () => void }) {
  const missingKey = error.code === "MISSING_KEY";
  const quota = error.code === "QUOTA";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="flex min-h-[560px] flex-col items-center justify-center px-6 py-16 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10">
        {missingKey ? (
          <KeyRound className="h-7 w-7 text-amber-300" />
        ) : quota ? (
          <TimerReset className="h-7 w-7 text-amber-300" />
        ) : (
          <TriangleAlert className="h-7 w-7 text-amber-300" />
        )}
      </div>
      <h3 className="mt-6 font-display text-xl font-semibold text-white">
        {missingKey ? "Falta apenas a chave gratuita da IA" : quota ? "Cota gratuita pausada" : "Não foi possível concluir"}
      </h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-mist">{error.message}</p>

      {missingKey && (
        <div className="glass mt-8 max-w-md rounded-2xl p-5 text-left">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-volt">Configuração em 2 minutos · 100% grátis</p>
          <ol className="mt-4 space-y-3 text-sm text-white/80">
            <li className="flex gap-3">
              <span className="font-mono text-volt">1.</span>
              <span>
                Acesse <span className="font-mono text-volt">aistudio.google.com</span> e clique em{" "}
                <em>Get API key</em> (só precisa de conta Google — o plano gratuito inclui busca na web).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-volt">2.</span>
              <span>
                Adicione a variável <span className="font-mono text-volt">GEMINI_API_KEY</span> nos Secrets
                do projeto com a chave gerada.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-volt">3.</span>
              <span>Pronto: a cota gratuita permite centenas de pesquisas com busca real por dia.</span>
            </li>
          </ol>
        </div>
      )}
      {quota && (
        <p className="mt-4 max-w-sm text-xs text-white/50">
          O nível gratuito do Gemini tem limite por minuto e por dia — a cota por minuto renova em
          instantes; a diária zera à meia-noite (horário do Pacífico).
        </p>
      )}
      <button
        onClick={onReset}
        className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm text-white/80 transition hover:border-volt/50 hover:text-volt"
      >
        <RotateCcw className="h-4 w-4" />
        Voltar
      </button>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Estado: resultados                                                  */
/* ------------------------------------------------------------------ */

const rowVariants = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.25 + i * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

import { SlidersHorizontal, Sparkles } from "lucide-react";
import type { AppliedFilters } from "@/lib/shared";

type SimilarFilter = "all" | "exact" | "similar";

function ResultsState({
  detail,
  copied,
  onCopy,
  onReset,
  onRefilter,
  refiltering,
}: {
  detail: SearchDetail;
  copied: boolean;
  onCopy: () => void;
  onReset: () => void;
  onRefilter: (filters: AppliedFilters) => void;
  refiltering: boolean;
}) {
  // Estados dos filtros — iniciam com os filtros usados nesta busca
  const [minScore, setMinScore] = useState<number>(detail.filters?.minScore ?? 5); // 5% a 100%
  const [similarFilter, setSimilarFilter] = useState<SimilarFilter>(detail.filters?.similarMode ?? "all");

  /* ---- dispara nova pesquisa real quando o usuário muda os filtros ---- */
  const lastRefilterKey = useRef<string>(`${detail.filters?.minScore ?? 5}|${detail.filters?.similarMode ?? "all"}`);
  const consultNow = useCallback(() => {
    const key = `${minScore}|${similarFilter}`;
    if (key === lastRefilterKey.current && !refiltering) return;
    lastRefilterKey.current = key;
    onRefilter({ minScore, similarMode: similarFilter });
  }, [minScore, similarFilter, onRefilter, refiltering]);
  useEffect(() => {
    const key = `${minScore}|${similarFilter}`;
    if (key === lastRefilterKey.current) return;
    const t = setTimeout(consultNow, 1100);
    return () => clearTimeout(t);
  }, [minScore, similarFilter, consultNow]);

  const filtersDirty =
    `${minScore}|${similarFilter}` !== `${detail.filters?.minScore ?? 5}|${detail.filters?.similarMode ?? "all"}`;

  // Itens filtrados dinamicamente em memória
  const filteredResults = detail.results.filter((r) => {
    const score = r.complianceScore ?? (r.compliant ? 100 : 50);
    if (score < minScore) return false;
    if (similarFilter === "exact" && r.isSimilar) return false;
    if (similarFilter === "similar" && !r.isSimilar) return false;
    return true;
  });

  // Estatísticas recalculadas dinamicamente com base nos itens filtrados
  const prices = filteredResults.map((r) => r.price);
  const dynMin = prices.length ? Math.min(...prices) : null;
  const dynMax = prices.length ? Math.max(...prices) : null;
  const dynAvg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const dynEconomy = dynMin != null && dynMax != null ? dynMax - dynMin : null;
  const partials = filteredResults.filter((r) => !r.compliant).length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-5 py-6 sm:px-7">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>Cotação gerada</Eyebrow>
          <h3 className="mt-2 max-w-xl font-display text-2xl font-semibold leading-tight text-white">
            {detail.title}
          </h3>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
            <span>{formatDateBR(detail.createdAt)}</span>
            {detail.model && <span className="font-mono">motor: {detail.model}</span>}
            <span className="rounded-full border border-volt/25 bg-volt/10 px-2 py-0.5 text-[11px] text-volt">
              {detail.fullMatches} de {detail.totalOptions} atendem 100%
            </span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onCopy}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
              copied
                ? "bg-volt text-ink"
                : "border border-white/15 text-white/80 hover:border-volt/50 hover:text-volt"
            }`}
          >
            {copied ? <ClipboardCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado!" : "Copiar relatório"}
          </button>
          <button
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-volt/50 hover:text-volt"
          >
            <RotateCcw className="h-4 w-4" />
            Nova busca
          </button>
        </div>
      </div>

      {/* Requisitos identificados */}
      {detail.requirements.length > 0 && (
        <div className="mt-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            Requisitos obrigatórios identificados ({detail.requirements.length})
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {detail.requirements.map((r) => (
              <span
                key={r}
                className="inline-flex max-w-full items-start gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs leading-snug text-white/75"
              >
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Barra de Filtros: Porcentagem de Atendimento (5% a 100%) e Similares */}
      <div className="glass mt-7 rounded-2xl border border-white/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-volt">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtros — aplicam nova pesquisa
          </p>
          <span className="font-mono text-xs text-white/50">
            Exibindo <strong className="text-volt">{filteredResults.length}</strong> de {detail.results.length} opções
          </span>
        </div>

        <div className="mt-4 grid gap-5 md:grid-cols-2">
          {/* Filtro 1: Slider de porcentagem (5% a 100%) */}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="compliance-slider" className="text-xs font-medium text-white/80">
                Atendimento mínimo do edital:
              </label>
              <span className="rounded-md border border-volt/30 bg-volt/10 px-2 py-0.5 font-mono text-xs font-bold text-volt">
                ≥ {minScore}%
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <input
                id="compliance-slider"
                type="range"
                min="5"
                max="100"
                step="5"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/15 accent-volt"
              />
            </div>
            {/* Botões de atalho de porcentagem */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { label: "100% (Integral)", val: 100 },
                { label: "≥ 80%", val: 80 },
                { label: "≥ 50%", val: 50 },
                { label: "Todos (≥ 5%)", val: 5 },
              ].map((btn) => (
                <button
                  key={btn.val}
                  onClick={() => setMinScore(btn.val)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                    minScore === btn.val
                      ? "bg-volt text-ink shadow-[0_0_12px_rgba(191,247,71,0.3)]"
                      : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-volt/40 hover:text-white"
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* Filtro 2: Similares e Equivalentes */}
          <div>
            <label className="block text-xs font-medium text-white/80">
              Filtro de Similares e Equivalentes:
            </label>
            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              {[
                { id: "all", label: "Todos" },
                { id: "exact", label: "Apenas Exatos" },
                { id: "similar", label: "Apenas Similares" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSimilarFilter(tab.id as SimilarFilter)}
                  className={`rounded-xl px-2 py-2 text-center text-xs font-medium transition ${
                    similarFilter === tab.id
                      ? "bg-volt text-ink font-semibold shadow-[0_0_12px_rgba(191,247,71,0.3)]"
                      : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-volt/40 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/40">
              {similarFilter === "all"
                ? "Marca exata + similares técnicos."
                : similarFilter === "exact"
                  ? "Somente marca/modelo exato do edital."
                  : "Somente equivalentes de outras marcas."}
            </p>
          </div>
        </div>

        {/* Botão CONSULTAR com os filtros escolhidos */}
        <button
          onClick={consultNow}
          disabled={refiltering || !filtersDirty}
          className={`group mt-4 flex w-full items-center justify-center gap-2.5 rounded-2xl px-5 py-3.5 font-display text-sm font-bold uppercase tracking-wide transition ${
            refiltering
              ? "cursor-wait bg-volt/60 text-ink"
              : filtersDirty
                ? "bg-volt text-ink shadow-[0_0_24px_rgba(191,247,71,0.3)] hover:shadow-[0_0_36px_rgba(191,247,71,0.5)]"
                : "cursor-not-allowed border border-white/10 bg-white/[0.03] text-white/35"
          }`}
        >
          {refiltering ? (
            <>
              <Loader2 className="h-4.5 w-4.5 animate-spin" />
              Consultando com seus filtros…
            </>
          ) : filtersDirty ? (
            <>
              <ScanSearch className="h-4.5 w-4.5 transition-transform group-hover:scale-110" />
              CONSULTAR COM ESTES FILTROS
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4.5 w-4.5" />
              Filtros atuais já consultados
            </>
          )}
        </button>
        {filtersDirty && !refiltering && (
          <p className="mt-2 text-center font-mono text-[11px] text-white/35">
            Nova pesquisa real na web (~ 60s) — também dispara automaticamente em 1s
          </p>
        )}
      </div>

      {/* Estatísticas dinâmicas recalculadas com base nos filtros */}
      <div className="mt-7 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: "Menor oferta (filtrada)", value: dynMin, accent: true },
          { label: "Preço médio", value: dynAvg, accent: false },
          { label: "Maior oferta", value: dynMax, accent: false },
          { label: "Economia potencial", value: dynEconomy, accent: false },
        ].map((s) => (
          <div key={s.label} className={`glass rounded-2xl p-4 ${s.accent ? "border-volt/25 bg-volt/[0.05]" : ""}`}>
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/40">{s.label}</p>
            <Money
              value={s.value}
              className={`mt-1.5 block font-mono text-lg font-semibold sm:text-xl ${s.accent ? "text-volt" : "text-white"}`}
            />
          </div>
        ))}
      </div>

      {/* Lista de ofertas filtradas */}
      <div className="mt-7 overflow-hidden rounded-2xl border border-white/10">
        {filteredResults.length === 0 ? (
          <div className="p-10 text-center">
            <TriangleAlert className="mx-auto h-8 w-8 text-amber-300/80" />
            <p className="mt-3 font-medium text-white">Nenhuma opção com os filtros selecionados</p>
            <p className="mt-1 text-xs text-mist">
              Tente diminuir a porcentagem mínima de atendimento (ex: ≥ 50%) ou alternar o filtro de similares.
            </p>
            <button
              onClick={() => {
                setMinScore(5);
                setSimilarFilter("all");
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-xs text-white/80 transition hover:border-volt/40 hover:text-volt"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar filtros (≥ 5% / Todos)
            </button>
          </div>
        ) : (
          filteredResults.map((r, i) => (
            <motion.a
              key={r.id}
              custom={i}
              variants={rowVariants}
              initial="hidden"
              animate="show"
              href={r.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={`group grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-white/5 px-4 py-4 transition last:border-b-0 hover:bg-white/[0.03] sm:grid-cols-[auto_auto_1fr_auto] sm:gap-4 sm:px-5 ${
                !r.compliant ? "bg-amber-400/[0.02]" : ""
              }`}
            >
              <span className="text-outline font-mono text-2xl font-bold sm:text-3xl">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="hidden sm:block">
                <SiteBadge site={r.site} />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/45">{r.brand}</span>
                  {r.trustedSite && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/90">
                      <ShieldCheck className="h-3 w-3" /> loja confiável
                    </span>
                  )}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-sm font-medium leading-snug text-white/90 transition group-hover:text-volt">
                  {r.name}
                </span>
                <span className="mt-1.5 flex flex-wrap items-center gap-2">
                  <ComplianceChip
                    compliant={r.compliant}
                    score={r.complianceScore}
                    isSimilar={r.isSimilar}
                    missingCount={r.missing.length}
                  />
                  <span className="sm:hidden"><SiteBadge site={r.site} size="sm" /></span>
                  <span className="text-[11px] text-white/40">{r.site}</span>
                </span>
                {!r.compliant && r.missing.length > 0 && (
                  <span className="mt-1.5 block text-[11px] leading-snug text-amber-300/80">
                    Não cumpre: {r.missing.join(" · ")}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2 sm:gap-3">
                <span className="text-right">
                  <Money value={r.price} className="block font-mono text-base font-semibold text-white sm:text-lg" />
                  <span className="hidden text-[10px] uppercase tracking-wider text-white/35 sm:block">
                    {r.priceSource === "busca"
                      ? "visto na busca"
                      : r.priceSource === "busca_loja"
                        ? "busca na loja"
                        : r.priceSource === "comparador"
                          ? "via comparador"
                          : "na página da loja"}
                  </span>
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/50 transition group-hover:border-volt group-hover:bg-volt group-hover:text-ink">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </span>
            </motion.a>
          ))
        )}
      </div>

      {partials > 0 && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-300/70">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {partials} opção(ões) na lista não cumprem 100% dos requisitos — você pode ajustar o filtro
          acima para &quot;100% (Integral)&quot; para ver apenas as estritamente conformes.
        </p>
      )}

      {/* Média recalculada */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 + filteredResults.length * 0.06, duration: 0.5 }}
        className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-volt/25 bg-gradient-to-r from-volt/[0.08] to-transparent px-5 py-4"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-volt/80">
          Média de preço das opções filtradas ({filteredResults.length})
        </p>
        <Money value={dynAvg} className="font-mono text-2xl font-bold text-volt sm:text-3xl" />
      </motion.div>

      {/* Fontes */}
      {(detail.sources.length > 0 || detail.searchQueries.length > 0) && (
        <details className="group mt-6 rounded-2xl border border-white/10 bg-white/[0.02] open:bg-white/[0.03]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm text-white/60 transition hover:text-white [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-volt/70" />
              Fontes reais consultadas pelo Google ({detail.sources.length})
            </span>
            <span className="font-mono text-xs text-white/30 transition group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-white/5 px-5 py-4">
            {detail.searchQueries.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {detail.searchQueries.slice(0, 8).map((q) => (
                  <span key={q} className="rounded-md bg-white/5 px-2 py-1 font-mono text-[10px] text-white/45">
                    {q}
                  </span>
                ))}
              </div>
            )}
            <ul className="space-y-1.5">
              {detail.sources.map((s) => (
                <li key={s.uri}>
                  <a
                    href={s.uri}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="block truncate text-xs text-white/50 transition hover:text-volt"
                  >
                    {s.title || s.uri}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-white/35">
        Preços capturados por IA em tempo real na data da busca — confirme valor, disponibilidade e frete
        no anúncio antes de formalizar a cotação (Lei nº 14.133/21). {formatBRL(detail.avgPrice ?? 0)} é a
        média aritmética simples das opções listadas.
      </p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Painel                                                              */
/* ------------------------------------------------------------------ */

export function ResultsPanel({
  phase,
  detail,
  error,
  copied,
  onCopy,
  onReset,
  onRefilter,
  refiltering,
}: {
  phase: Phase;
  detail: SearchDetail | null;
  error: PanelError | null;
  copied: boolean;
  onCopy: () => void;
  onReset: () => void;
  onRefilter: (filters: AppliedFilters) => void;
  refiltering: boolean;
}) {
  return (
    <div className="glass relative min-h-[560px] overflow-hidden rounded-3xl">
      {/* faixa de repesquisa com os filtros — mantém o resultado anterior visível */}
      {refiltering && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 bg-ink/85 px-4 py-2.5 text-xs text-volt backdrop-blur-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          RePesquisando com seus filtros (atendimento ≥ {detail?.filters?.minScore ?? 5}% ·{" "}
          {detail?.filters?.similarMode === "exact"
            ? "apenas exatos"
            : detail?.filters?.similarMode === "similar"
              ? "apenas similares"
              : "todos"})
        </div>
      )}
      <AnimatePresence mode="wait">
        {phase === "loading" && <LoadingState key="loading" />}
        {phase === "idle" && <EmptyState key="empty" />}
        {phase === "error" && error && <ErrorState key="error" error={error} onReset={onReset} />}
        {phase === "done" && detail && (
          <ResultsState
            key={`${detail.id}-${detail.filters?.minScore ?? 5}-${detail.filters?.similarMode ?? "all"}`}
            detail={detail}
            copied={copied}
            onCopy={onCopy}
            onReset={onReset}
            onRefilter={onRefilter}
            refiltering={refiltering}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
