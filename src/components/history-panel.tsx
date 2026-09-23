"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight, History, Trash2 } from "lucide-react";
import { formatBRL, formatDateBR, type SearchSummary } from "@/lib/shared";

import { useState } from "react";
import { AlertCircle, Check } from "lucide-react";

export function HistoryPanel({
  searches,
  activeId,
  loading,
  onSelect,
  onDelete,
  onDeleteAll,
}: {
  searches: SearchSummary[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
}) {
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-volt/80">
            <History className="h-3.5 w-3.5" />
            Histórico
          </p>
          <h2 className="mt-2 font-display text-xl font-semibold text-white">Suas cotações recentes</h2>
        </div>
        {searches.length > 0 && (
          <div className="flex items-center gap-3">
            <p className="font-mono text-xs text-white/35">{searches.length} salvas</p>
            {confirmDeleteAll ? (
              <div className="flex items-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200">
                <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
                <span>Apagar tudo?</span>
                <button
                  onClick={() => {
                    onDeleteAll();
                    setConfirmDeleteAll(false);
                  }}
                  className="rounded-lg bg-rose-500 px-2 py-0.5 font-semibold text-white transition hover:bg-rose-600"
                >
                  Sim, limpar
                </button>
                <button
                  onClick={() => setConfirmDeleteAll(false)}
                  className="rounded-lg border border-white/20 px-2 py-0.5 text-white/70 hover:text-white"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteAll(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 transition hover:border-rose-400/40 hover:bg-rose-400/10 hover:text-rose-300"
                title="Esvaziar todas as cotações"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Limpar histórico
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="glass grid gap-2 rounded-3xl p-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[74px] animate-pulse rounded-2xl bg-white/[0.03]" />
            ))}
          </div>
        ) : searches.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/12 px-6 py-10 text-center">
            <p className="text-sm text-white/45">
              Nenhuma cotação ainda. Faça a primeira busca acima — ela ficará salva aqui para consulta
              e montagem da sua planilha de preços.
            </p>
          </div>
        ) : (
          <ul className="glass divide-y divide-white/5 overflow-hidden rounded-3xl">
            <AnimatePresence initial={false}>
              {searches.map((s) => (
                <motion.li
                  key={s.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.25 }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(s.id)}
                    onKeyDown={(e) => e.key === "Enter" && onSelect(s.id)}
                    className={`group grid cursor-pointer grid-cols-[1fr_auto] items-center gap-3 px-5 py-4 transition hover:bg-white/[0.03] sm:grid-cols-[1fr_auto_auto_auto_auto] ${
                      activeId === s.id ? "bg-volt/[0.04]" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-white/90 transition group-hover:text-volt">
                        {s.title}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-white/35">
                        {formatDateBR(s.createdAt)} · {s.totalOptions} opções · {s.fullMatches} 100%
                      </span>
                    </span>
                    <span className="hidden text-right sm:block">
                      <span className="block text-[10px] uppercase tracking-wider text-white/35">menor</span>
                      <span className="font-mono text-sm font-semibold text-volt">{formatBRL(s.minPrice)}</span>
                    </span>
                    <span className="hidden text-right sm:block">
                      <span className="block text-[10px] uppercase tracking-wider text-white/35">média</span>
                      <span className="font-mono text-sm text-white/75">{formatBRL(s.avgPrice)}</span>
                    </span>
                    <ArrowUpRight className="hidden h-4 w-4 text-white/30 transition group-hover:text-volt sm:block" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(s.id);
                      }}
                      aria-label="Excluir cotação"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white/30 transition hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}
