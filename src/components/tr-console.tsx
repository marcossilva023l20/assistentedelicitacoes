"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight,
  ClipboardCheck,
  Copy,
  FileUp,
  FileText,
  Loader2,
  Play,
  RotateCcw,
  Square,
  Sigma,
  TriangleAlert,
  X,
} from "lucide-react";
import { Money } from "@/components/bits";
import {
  buildTrReport,
  formatBRL,
  type SearchDetail,
  type SearchSummary,
  type TrBatchState,
  type TrItemState,
} from "@/lib/shared";

type ItemStatus = "idle" | "running" | "done" | "error";

interface UiItem {
  status: ItemStatus;
  error?: string;
  search?: SearchSummary | null;
}

const ACCEPT = ".pdf,.docx,.txt,.md,.csv";

export function TrConsole({
  onShowDetail,
  onHistoryChanged,
}: {
  onShowDetail: (detail: SearchDetail) => void;
  onHistoryChanged: () => void;
}) {
  const [batch, setBatch] = useState<TrBatchState | null>(null);
  const [uiItems, setUiItems] = useState<Map<number, UiItem>>(new Map());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importVia, setImportVia] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const runningAllRef = useRef(false);

  /* ------------------------- carregar último TR ------------------------- */
  useEffect(() => {
    fetch("/api/tr")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.batch) {
          const b = d.batch as TrBatchState;
          setBatch(b);
          const m = new Map<number, UiItem>();
          for (const it of b.items) m.set(it.order, { status: it.search ? "done" : "idle", search: it.search });
          setUiItems(m);
        }
      })
      .catch(() => undefined);
  }, []);

  /* ------------------------------ importar ------------------------------ */
  const importFile = useCallback(
    async (file: File) => {
      setImporting(true);
      setImportError(null);
      setImportVia(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/tr/import", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Falha ao importar.");
        const b = data.batch as TrBatchState;
        setBatch(b);
        setImportVia(data.via === "ia" ? "IA" : "parser local");
        const m = new Map<number, UiItem>();
        for (const it of b.items) m.set(it.order, { status: "idle" });
        setUiItems(m);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Erro ao importar arquivo.");
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    []
  );

  /* ------------------------------ rodar item ----------------------------- */
  const runItem = useCallback(
    async (order: number): Promise<boolean> => {
      if (!batch) return false;
      setUiItems((m) => new Map(m).set(order, { status: "running" }));
      try {
        const res = await fetch("/api/tr/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: batch.id, order }),
        });
        const data = await res.json();
        if (!res.ok) {
          setUiItems((m) => new Map(m).set(order, { status: "error", error: data.error ?? "Erro na busca." }));
          return false;
        }
        const detail = (data as { search: SearchDetail }).search;
        const summary: SearchSummary = {
          id: detail.id,
          title: detail.title,
          createdAt: detail.createdAt,
          totalOptions: detail.totalOptions,
          fullMatches: detail.fullMatches,
          minPrice: detail.minPrice,
          avgPrice: detail.avgPrice,
        };
        setUiItems((m) => new Map(m).set(order, { status: "done", search: summary }));
        onShowDetail(detail);
        onHistoryChanged();
        return true;
      } catch {
        setUiItems((m) => new Map(m).set(order, { status: "error", error: "Falha de comunicação." }));
        return false;
      }
    },
    [batch, onShowDetail, onHistoryChanged]
  );

  const runAll = useCallback(async () => {
    if (!batch || runningAllRef.current) return;
    runningAllRef.current = true;
    setRunningAll(true);
    stopRef.current = false;
    for (const it of batch.items) {
      if (stopRef.current) break;
      const st = uiItems.get(it.order)?.status;
      if (st === "done" || st === "running") continue;
      await runItem(it.order);
    }
    runningAllRef.current = false;
    setRunningAll(false);
  }, [batch, uiItems, runItem]);

  const stopAll = useCallback(() => {
    stopRef.current = true;
  }, []);

  /* --------------------------- relatório consolidado --------------------------- */
  const copyTrReport = useCallback(async () => {
    if (!batch) return;
    try {
      const items = await Promise.all(
        batch.items.map(async (it) => {
          const summary = uiItems.get(it.order)?.search;
          let detail: SearchDetail | null = null;
          if (summary) {
            try {
              const res = await fetch(`/api/searches/${summary.id}`);
              if (res.ok) detail = ((await res.json()) as { search: SearchDetail }).search;
            } catch {
              /* ignora */
            }
          }
          return { label: it.label, title: it.title, qty: it.qty, detail };
        })
      );
      await navigator.clipboard.writeText(buildTrReport(batch.filename, items));
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard bloqueado */
    }
  }, [batch, uiItems]);

  /* ------------------------------ derivados ------------------------------ */
  const doneItems = batch?.items.filter((it) => uiItems.get(it.order)?.search?.minPrice != null) ?? [];
  const totalEstimado = doneItems.reduce(
    (acc, it) => acc + (uiItems.get(it.order)?.search?.minPrice as number) * (it.qty ?? 1),
    0
  );
  const doneCount = batch?.items.filter((it) => uiItems.get(it.order)?.status === "done").length ?? 0;
  const progress = batch ? Math.round((doneCount / batch.itemCount) * 100) : 0;

  /* --------------------------------- UI --------------------------------- */
  return (
    <section id="tr-console" className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-volt/80">
            <FileText className="h-3.5 w-3.5" />
            Termo de referência
          </p>
          <h2 className="mt-2 font-display text-xl font-semibold text-white">
            Importe o TR inteiro — eu separo os itens e pesquiso cada um
          </h2>
        </div>
        {batch && (
          <div className="flex gap-2">
            <button
              onClick={copyTrReport}
              disabled={doneCount === 0}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                copied
                  ? "bg-volt font-medium text-ink"
                  : "border border-white/15 text-white/80 hover:border-volt/50 hover:text-volt disabled:cursor-not-allowed disabled:opacity-35"
              }`}
            >
              {copied ? <ClipboardCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copiado!" : "Relatório do TR"}
            </button>
            <button
              onClick={() => {
                setBatch(null);
                setUiItems(new Map());
                setImportError(null);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white/60 transition hover:border-white/30 hover:text-white"
            >
              <X className="h-4 w-4" />
              Novo TR
            </button>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {!batch ? (
          <motion.div
            key="drop"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`mt-5 flex flex-col items-center justify-center rounded-3xl border border-dashed px-6 py-12 text-center transition ${
              dragOver ? "border-volt/60 bg-volt/[0.04]" : "border-white/15 bg-white/[0.015]"
            } ${importing ? "pointer-events-none opacity-70" : "cursor-pointer"}`}
            onClick={() => !importing && fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f && !importing) importFile(f);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFile(f);
              }}
            />
            {importing ? (
              <>
                <Loader2 className="h-9 w-9 animate-spin text-volt" />
                <p className="mt-4 font-display text-lg font-semibold text-white">Lendo o documento…</p>
                <p className="mt-1 text-sm text-mist">Extraindo o texto e separando os itens do TR.</p>
              </>
            ) : (
              <>
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-volt/25 bg-volt/10">
                  <FileUp className="h-6 w-6 text-volt" />
                </span>
                <p className="mt-4 font-display text-lg font-semibold text-white">
                  Arraste o TR aqui ou clique para escolher
                </p>
                <p className="mt-1 max-w-md text-sm text-mist">
                  PDF, DOCX, TXT, MD ou CSV (até 12 MB). A IA identifica os itens numerados, suas
                  especificações e quantidades — e você pesquisa tudo com um clique.
                </p>
                <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-volt px-5 py-2.5 text-sm font-semibold text-ink transition hover:shadow-[0_0_28px_rgba(191,247,71,0.35)]">
                  <FileUp className="h-4 w-4" />
                  Importar Termo de Referência
                </span>
              </>
            )}
            {importError && (
              <p className="mt-4 max-w-lg rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-200">
                {importError}
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-5 overflow-hidden rounded-3xl border border-white/10"
          >
            {/* cabeçalho do TR */}
            <div className="glass flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  <FileText className="mr-2 inline h-4 w-4 text-volt/80" />
                  {batch.filename}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-white/40">
                  {batch.itemCount} itens identificados{importVia ? ` • separados por ${importVia}` : ""} •{" "}
                  {doneCount} pesquisados
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="mr-1 hidden h-1.5 w-32 overflow-hidden rounded-full bg-white/10 sm:block">
                  <div className="h-full rounded-full bg-volt transition-all duration-500" style={{ width: `${progress}%` }} />
                </div>
                {runningAll ? (
                  <button
                    onClick={stopAll}
                    className="inline-flex items-center gap-2 rounded-full border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm text-red-300 transition hover:bg-red-400/20"
                  >
                    <Square className="h-3.5 w-3.5" />
                    Parar após este item
                  </button>
                ) : (
                  <button
                    onClick={runAll}
                    disabled={doneCount === batch.itemCount}
                    className="group inline-flex items-center gap-2 rounded-full bg-volt px-4 py-2 text-sm font-semibold text-ink transition enabled:hover:shadow-[0_0_28px_rgba(191,247,71,0.35)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Play className="h-4 w-4" />
                    {doneCount === 0 ? "Pesquisar todos" : doneCount < batch.itemCount ? "Continuar busca" : "Tudo pesquisado"}
                  </button>
                )}
              </div>
            </div>

            {/* itens */}
            <ul className="divide-y divide-white/5 bg-ink/60">
              {batch.items.map((it) => {
                const ui = uiItems.get(it.order);
                const st = ui?.status ?? "idle";
                const summary = ui?.search;
                return (
                  <li key={it.order} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-3.5 transition hover:bg-white/[0.02] sm:grid-cols-[auto_1fr_auto_auto_auto] sm:gap-4 sm:px-6">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] font-mono text-xs font-bold text-volt">
                      {String(it.order).padStart(2, "0")}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-white/90">
                        <span className="mr-2 font-mono text-[11px] uppercase text-white/35">{it.label}</span>
                        {it.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-white/40">
                        Qtd: <span className="font-mono">{it.qty ?? 1}</span>
                        {st === "error" && ui?.error && (
                          <span className="ml-2 text-amber-300/90">• {ui.error}</span>
                        )}
                      </span>
                    </span>

                    {/* status */}
                    <span className="hidden sm:block">
                      {st === "done" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-volt/25 bg-volt/10 px-2.5 py-1 text-[11px] text-volt">
                          {summary?.totalOptions ?? 0} opções · {summary?.fullMatches ?? 0} 100%
                        </span>
                      ) : st === "running" ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-volt/80">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          pesquisando
                        </span>
                      ) : st === "error" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-300">
                          <TriangleAlert className="h-3 w-3" />
                          erro
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 font-mono text-[11px] text-white/30">pendente</span>
                      )}
                    </span>

                    {/* menor preço */}
                    <span className="text-right">
                      {summary?.minPrice != null ? (
                        <>
                          <Money value={summary.minPrice} className="block font-mono text-sm font-semibold text-volt" />
                          <span className="block text-[10px] uppercase tracking-wider text-white/35">menor unit.</span>
                        </>
                      ) : (
                        <span className="font-mono text-xs text-white/25">—</span>
                      )}
                    </span>

                    {/* ações */}
                    <span className="flex items-center gap-1.5">
                      {st === "done" && summary ? (
                        <>
                          <button
                            onClick={async () => {
                              const res = await fetch(`/api/searches/${summary.id}`);
                              if (res.ok) onShowDetail(((await res.json()) as { search: SearchDetail }).search);
                            }}
                            title="Ver resultado deste item"
                            className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition hover:border-volt/50 hover:text-volt"
                          >
                            VER COTAÇÃO
                          </button>
                          <button
                            onClick={() => runItem(it.order)}
                            title="Refazer busca deste item"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-white/35 transition hover:bg-white/10 hover:text-volt"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => runItem(it.order)}
                          disabled={st === "running" || runningAll}
                          title={st === "error" ? "Tentar de novo" : "Pesquisar este item"}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-bold tracking-wide transition disabled:cursor-not-allowed ${
                            st === "running"
                              ? "bg-volt/60 text-ink"
                              : st === "error"
                                ? "border border-amber-400/40 text-amber-300 enabled:hover:bg-amber-400/10"
                                : "bg-volt text-ink enabled:hover:shadow-[0_0_20px_rgba(191,247,71,0.35)]"
                          }`}
                        >
                          {st === "running" ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              CONSULTANDO…
                            </>
                          ) : st === "error" ? (
                            <>
                              <RotateCcw className="h-3.5 w-3.5" />
                              RETENTAR
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5" />
                              CONSULTAR
                            </>
                          )}
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            {/* total consolidado */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-volt/20 bg-gradient-to-r from-volt/[0.07] to-transparent px-5 py-4 sm:px-6">
              <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-volt/80">
                <Sigma className="h-4 w-4" />
                Valor estimado do objeto ({doneCount}/{batch.itemCount} itens cotados)
              </p>
              <div className="text-right">
                <Money value={doneItems.length ? totalEstimado : null} className="font-mono text-2xl font-bold text-volt" />
                <p className="text-[10px] uppercase tracking-wider text-white/35">soma dos menores preços × quantidades</p>
              </div>
            </div>

            <p className="border-t border-white/5 bg-ink/60 px-5 py-3 text-[11px] leading-relaxed text-white/35 sm:px-6">
              A busca de cada item leva ~45–90s e roda um por vez (para não estourar a cota gratuita da IA). Você
              pode parar e continuar depois — o progresso fica salvo. {formatBRL(totalEstimado)} é apenas uma
              referência para a planilha de preços; confirme sempre no anúncio antes de formalizar a cotação.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
