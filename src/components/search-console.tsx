"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  FileText,
  Gavel,
  ImagePlus,
  Loader2,
  ScanLine,
  Sparkles,
  X,
} from "lucide-react";
import { ResultsPanel, type PanelError, type Phase } from "@/components/results-panel";
import { HistoryPanel } from "@/components/history-panel";
import { TrConsole } from "@/components/tr-console";
import { buildPlainReport, type SearchDetail, type SearchSummary } from "@/lib/shared";

/* ------------------------------------------------------------------ */

const EXAMPLES = [
  {
    label: "Notebook i5",
    text: "Notebook empresarial, processador Intel Core i5 de 12ª geração ou superior, memória RAM 8 GB DDR4 ou superior, armazenamento SSD NVMe de 256 GB ou superior, tela de 14 polegadas Full HD antirreflexo, sistema operacional Windows 11 Pro, webcam HD integrada, bateria com autonomia mínima de 6 horas, garantia de no mínimo 12 meses. Produto novo, com nota fiscal.",
  },
  {
    label: "Ar-condicionado 12k BTU",
    text: "Ar-condicionado tipo Split Hi-Wall, capacidade de 12.000 BTU/h, ciclo frio, gás refrigerante ecológico R-32 ou R-410A, classificação A no Procel/Inmetro, tensão 220V monofásico, acompanha controle remoto, garantia mínima de 12 meses. Produto novo, com nota fiscal, entrega no Brasil.",
  },
  {
    label: "Cadeira ergonômica NR-17",
    text: "Cadeira de escritório giratória ergonômica em conformidade com a NR-17, regulagem de altura a gás, encosto em tela mesh respirável com apoio lombar, apoios de braços com regulagem, base em nylon com 5 rodízios, assento em espuma injetada, capacidade mínima de 120 kg. Produto novo, garantia de 12 meses.",
  },
];

const SITES = [
  "Amazon",
  "Mercado Livre",
  "Magazine Luiza",
  "Casas Bahia",
  "Le Biscuit",
  "Shopee",
  "Americanas",
  "KaBuM!",
  "Pichau",
  "Extra",
  "Ponto Frio",
  "Fast Shop",
  "Submarino",
  "Carrefour",
  "Shein",
];

const MAX_LEN = 8000;

interface Status {
  configured: boolean;
  model: string;
  mercadoLivreApi?: boolean;
}

/** Reduz a foto antes de enviar (menos bytes, mais velocidade). */
function resizeImage(file: File, maxSide = 1280): Promise<{ blob: Blob; url: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Falha ao processar a imagem."));
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      canvas.toBlob(
        (b) => (b ? resolve({ blob: b, url: canvas.toDataURL("image/jpeg", 0.85) }) : reject(new Error("Falha ao processar a imagem."))),
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => reject(new Error("Arquivo de imagem inválido."));
    img.src = URL.createObjectURL(file);
  });
}

/* ------------------------------------------------------------------ */

export default function SearchConsole() {
  const [status, setStatus] = useState<Status | null>(null);
  const [editalText, setEditalText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState<SearchDetail | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<SearchSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pastedFlash, setPastedFlash] = useState(false);
  const [refiltering, setRefiltering] = useState(false);
  const [imageDragging, setImageDragging] = useState(false);

  const resultsRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/searches", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { searches: SearchSummary[] };
        setHistory(data.searches);
      }
    } catch {
      /* silencioso */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus(d as Status))
      .catch(() => setStatus({ configured: false, model: "gemini" }));
    refreshHistory();
  }, [refreshHistory]);

  const scrollToResults = useCallback(() => {
    requestAnimationFrame(() =>
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }, []);

  const runSearch = useCallback(
    async (filters?: { minScore: number; similarMode: "all" | "exact" | "similar" }) => {
      const text = editalText.trim();
      const busy = phase === "loading" || refiltering;
      if (text.length < 15 || busy) return;
      const isRefilter = Boolean(filters);
      if (isRefilter) setRefiltering(true);
      else setPhase("loading");
      setError(null);
      setCopied(false);
      scrollToResults();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 200_000);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            filters ? { editalText: text, filters } : { editalText: text }
          ),
          signal: controller.signal,
        });
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        setError({
          message:
            "O servidor demorou mais do que o limite da rede (as lojas de varredura ficaram lentas). Tente novamente — na segunda tentativa o cache da web costuma responder mais rápido.",
        });
        setPhase("error");
        return;
      }
      if (!res.ok) {
        setError({
          message: (data.error as string) ?? "Erro inesperado.",
          code: data.code as string | undefined,
        });
        setPhase("error");
        return;
      }
      setDetail((data as { search: SearchDetail }).search);
      setPhase("done");
      refreshHistory();
    } catch {
      setError({
        message:
          "Tempo limite de comunicação excedido. A busca percorre várias lojas em tempo real — aguarde uns instantes e clique em buscar de novo.",
      });
      setPhase("error");
    } finally {
      clearTimeout(timeout);
      setRefiltering(false);
    }
  }, [editalText, phase, refiltering, refreshHistory, scrollToResults]);

  const loadSearch = useCallback(
    async (id: string) => {
      setPhase("loading");
      setError(null);
      setCopied(false);
      scrollToResults();
      try {
        const res = await fetch(`/api/searches/${id}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Não encontrado");
        setDetail((data as { search: SearchDetail }).search);
        setPhase("done");
      } catch {
        setError({ message: "Não foi possível carregar esta cotação." });
        setPhase("error");
      }
    },
    [scrollToResults]
  );

  const deleteSearch = useCallback(
    async (id: string) => {
      setHistory((h) => h.filter((s) => s.id !== id));
      if (detail?.id === id) {
        setDetail(null);
        setPhase("idle");
      }
      fetch(`/api/searches/${id}`, { method: "DELETE" }).catch(() => refreshHistory());
    },
    [detail, refreshHistory]
  );

  const deleteAllSearches = useCallback(async () => {
    setHistory([]);
    setDetail(null);
    setPhase("idle");
    try {
      await fetch("/api/searches", { method: "DELETE" });
      refreshHistory();
    } catch {
      refreshHistory();
    }
  }, [refreshHistory]);

  const copyReport = useCallback(async () => {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(buildPlainReport(detail));
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard bloqueado */
    }
  }, [detail]);

  const resetToIdle = useCallback(() => {
    setPhase("idle");
    setError(null);
    textareaRef.current?.focus();
  }, []);

  /* atalho ⌘/Ctrl + Enter */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        runSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runSearch]);

  const runImageSearch = useCallback(async () => {
    if (!imageBlob || phase === "loading") return;
    setPhase("loading");
    setError(null);
    setCopied(false);
    scrollToResults();
    try {
      const form = new FormData();
      form.append("file", imageBlob, "produto.jpg");
      const res = await fetch("/api/analyze-image", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError({ message: data.error ?? "Erro inesperado.", code: data.code });
        setPhase("error");
        return;
      }
      const { search, identified } = data as { search: SearchDetail; identified: { title: string; description: string } };
      setDetail(search);
      setEditalText(identified.description);
      setPhase("done");
      refreshHistory();
    } catch {
      setError({
        message: "Falha de comunicação com o servidor ao enviar a imagem — tente de novo.",
      });
      setPhase("error");
    }
  }, [imageBlob, phase, refreshHistory, scrollToResults]);

  const handleImagePick = useCallback(async (file: File) => {
    try {
      const { blob, url } = await resizeImage(file);
      setImageBlob(blob);
      setImagePreview(url);
    } catch {
      setError({ message: "Não consegui ler essa imagem. Tente outra (JPG/PNG/WEBP)." });
      setPhase("error");
    }
  }, []);

  const clearImage = useCallback(() => {
    setImageBlob(null);
    setImagePreview(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }, []);

  /* colar imagem direto da área de transferência (Ctrl/⌘ + V) */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            handleImagePick(f);
            setPastedFlash(true);
            setTimeout(() => setPastedFlash(false), 1800);
          }
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleImagePick]);

  /* arrastar e soltar imagem em qualquer lugar da página */
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        setImageDragging(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setImageDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith("image/")) {
        e.preventDefault();
        handleImagePick(f);
      }
      setImageDragging(false);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleImagePick]);

  const canSubmit = editalText.trim().length >= 15 && phase !== "loading";

  return (
    <>
      {/* ------------------------------ header ------------------------------ */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-ink/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <a href="#top" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-volt text-ink shadow-[0_0_24px_rgba(191,247,71,0.35)]">
              <Gavel className="h-5 w-5" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-white">
              Licita<span className="text-volt">Preço</span>
            </span>
          </a>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 sm:flex">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status == null
                    ? "animate-blink bg-white/40"
                    : status.configured
                      ? "bg-volt shadow-[0_0_10px_2px_rgba(191,247,71,0.5)]"
                      : "animate-blink bg-amber-400"
                }`}
              />
              {status == null
                ? "conectando…"
                : status.configured
                  ? `IA gratuita ativa · ${status.model}`
                  : "configure a chave da IA"}
            </span>
          </div>
        </div>
      </header>

      <main id="top" className="relative mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        {/* brilhos de fundo */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,black,transparent)]" />
          <div className="absolute -top-32 left-1/2 h-80 w-[44rem] -translate-x-1/2 rounded-full bg-volt/[0.07] blur-[120px]" />
          <div className="absolute right-[-10rem] top-[38rem] h-72 w-72 rounded-full bg-emerald-500/[0.06] blur-[100px]" />
        </div>

        {/* ------------------------------ hero ------------------------------ */}
        <section className="pb-12 pt-28 sm:pt-32">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-volt/80">
              <Sparkles className="h-3.5 w-3.5" />
              Pesquisa de preços para licitações · IA + busca real na web
            </p>
            <h1 className="mt-5 max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl">
              Do edital ao <span className="shine-text">menor preço</span>. Em minutos.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-mist sm:text-lg">
              Cole o item do edital. A IA extrai os requisitos obrigatórios, varre os maiores
              marketplaces do Brasil e devolve até 10 ofertas que atendem{" "}
              <strong className="font-semibold text-white">100% das especificações</strong> —
              ordenadas da mais barata à mais cara, com link direto e média de preços.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {["15 marketplaces priorizados", "Importe o TR inteiro (PDF/DOCX) e pesquise todos os itens", "Relatório pronto para a planilha de cotação"].map(
                (t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60"
                  >
                    <BadgeCheck className="h-3.5 w-3.5 text-volt" />
                    {t}
                  </span>
                )
              )}
            </div>
          </motion.div>
        </section>

        {/* ------------------------------ ferramenta ------------------------------ */}
        <section className="grid gap-5 lg:grid-cols-[minmax(360px,430px)_1fr]">
          {/* entrada */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="lg:sticky lg:top-24 lg:self-start"
          >
            <div className="corner glass relative rounded-3xl p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.24em] text-volt/80">
                  <FileText className="h-3.5 w-3.5" />
                  Item do edital
                </p>
                <span className="font-mono text-[11px] text-white/30">
                  {editalText.length}/{MAX_LEN}
                </span>
              </div>

              <textarea
                ref={textareaRef}
                value={editalText}
                onChange={(e) => setEditalText(e.target.value.slice(0, MAX_LEN))}
                placeholder={
                  "Cole aqui a descrição completa do item com as especificações técnicas.\n\nEx.: “Nobreak 3.000 VA, dupla conversão, senoidal pura, tensão bivolt, 8 tomadas, autonomia mínima 30 min a meia carga, garantia 3 anos…”"
                }
                spellCheck={false}
                className="mt-4 min-h-[300px] w-full resize-y rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-[13px] leading-relaxed text-white/85 placeholder:text-white/25 focus:border-volt/50 focus:outline-none focus:ring-2 focus:ring-volt/15"
              />

              <div className="mt-3 flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => {
                      setEditalText(ex.text);
                      textareaRef.current?.focus();
                    }}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-white/55 transition hover:border-volt/40 hover:text-volt"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>

              {/* busca por foto */}
              <div className="mt-3">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImagePick(f);
                  }}
                />
                {imagePreview && imageBlob ? (
                  <div
                    className={`flex items-center gap-3 rounded-2xl border p-3 transition ${
                      pastedFlash ? "border-volt bg-volt/[0.1]" : "border-volt/25 bg-volt/[0.04]"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreview}
                      alt="Foto do produto a identificar"
                      className="h-16 w-16 shrink-0 rounded-xl border border-white/10 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-snug text-white/70">
                        {pastedFlash ? (
                          <span className="font-medium text-volt">Imagem colada! </span>
                        ) : null}
                        A IA identifica o produto (marca, modelo e atributos) e busca os menores preços.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={runImageSearch}
                          disabled={phase === "loading"}
                          className="inline-flex items-center gap-1.5 rounded-full bg-volt px-3.5 py-1.5 text-xs font-semibold text-ink transition enabled:hover:shadow-[0_0_20px_rgba(191,247,71,0.35)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ScanLine className="h-3.5 w-3.5" />
                          Identificar e buscar
                        </button>
                        <button
                          onClick={clearImage}
                          disabled={phase === "loading"}
                          className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:text-white disabled:opacity-40"
                        >
                          <X className="h-3.5 w-3.5" />
                          Remover
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    disabled={phase === "loading"}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-3 text-xs text-white/55 transition enabled:hover:border-volt/40 enabled:hover:text-volt disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ImagePlus className="h-4 w-4" />
                    Busque por foto — <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">Ctrl+V</kbd>{" "}
                    cole, arraste ou clique
                  </button>
                )}
              </div>

              <button
                onClick={() => runSearch()}
                disabled={!canSubmit}
                className="group mt-4 flex w-full items-center justify-center gap-2.5 rounded-2xl bg-volt px-5 py-4 font-display text-sm font-bold uppercase tracking-wide text-ink transition enabled:hover:shadow-[0_0_36px_rgba(191,247,71,0.4)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                {phase === "loading" ? (
                  <>
                    <Loader2 className="h-4.5 w-4.5 animate-spin" />
                    Consultando na web…
                  </>
                ) : (
                  <>
                    CONSULTAR MENOR PREÇO
                    <ArrowRight className="h-4.5 w-4.5 transition-transform group-enabled:group-hover:translate-x-1" />
                  </>
                )}
              </button>
              <p className="mt-2.5 text-center font-mono text-[11px] text-white/30">
                ⌘/Ctrl + Enter para buscar
              </p>
            </div>

            {/* marquee das lojas */}
            <div className="mask-fade-x mt-4 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02] py-2.5">
              <div className="flex w-max animate-marquee gap-6 whitespace-nowrap">
                {[...SITES, ...SITES].map((s, i) => (
                  <span key={`${s}-${i}`} className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">
                    {s}
                    <span className="h-1 w-1 rounded-full bg-volt/50" />
                  </span>
                ))}
              </div>
            </div>

            {/* aviso: cobertura ML/Amazon quando APIs não configuradas */}
            {status && status.configured && status.mercadoLivreApi === false && (
              <details className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-white/55 open:bg-white/[0.03]">
                <summary className="cursor-pointer list-none font-medium text-white/60 transition hover:text-white [&::-webkit-details-marker]:hidden">
                  Mercado Livre: como ativar a busca garantida{" "}
                  <span className="ml-1 inline-block font-mono text-volt/70">+</span>
                </summary>
                <div className="mt-2.5 space-y-1.5 leading-relaxed">
                  <p>
                    O Mercado Livre saiu dos comparadores (2016) e bloqueia acesso de servidores — por isso
                    a cobertura dele é irregular. Com a <strong className="text-white/85">API oficial gratuita</strong>,
                    o sistema passa a ter anúncios diretos do ML em toda busca.
                  </p>
                  <ol className="list-decimal space-y-1 pl-4">
                    <li>
                      Crie um app grátis em{" "}
                      <span className="font-mono text-volt/80">developers.mercadolivre.com.br</span> (login com conta do ML).
                    </li>
                    <li>
                      Copie o <span className="font-mono text-volt/80">Client ID</span> e o{" "}
                      <span className="font-mono text-volt/80">Client Secret</span>.
                    </li>
                    <li>
                      Adicione os secrets{" "}
                      <span className="font-mono text-volt/80">MERCADO_LIVRE_CLIENT_ID</span> e{" "}
                      <span className="font-mono text-volt/80">MERCADO_LIVRE_CLIENT_SECRET</span> no projeto.
                    </li>
                  </ol>
                </div>
              </details>
            )}
          </motion.div>

          {/* resultados */}
          <motion.div
            ref={resultsRef}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="scroll-mt-20"
          >
            <ResultsPanel
              phase={phase}
              detail={detail}
              error={error}
              copied={copied}
              onCopy={copyReport}
              onReset={resetToIdle}
              onRefilter={(f) => runSearch(f)}
              refiltering={refiltering}
            />
          </motion.div>
        </section>

        {/* ------------------------------ TR em lote ------------------------------ */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6 }}
        >
          <TrConsole
            onShowDetail={(d) => {
              setDetail(d);
              setPhase("done");
              setError(null);
              setCopied(false);
            }}
            onHistoryChanged={refreshHistory}
          />
        </motion.div>

        {/* ------------------------------ histórico ------------------------------ */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6 }}
        >
          <HistoryPanel
            searches={history}
            activeId={detail?.id ?? null}
            loading={historyLoading}
            onSelect={loadSearch}
            onDelete={deleteSearch}
            onDeleteAll={deleteAllSearches}
          />
        </motion.div>
      </main>

      {/* ------------------------ overlay de arrastar imagem ------------------------ */}
      {imageDragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-volt/60 bg-volt/[0.06] px-12 py-10">
            <ImagePlus className="h-10 w-10 text-volt" />
            <p className="font-display text-lg font-semibold text-white">Solte a foto do produto aqui</p>
            <p className="text-sm text-mist">A IA identifica e busca os menores preços</p>
          </div>
        </div>
      )}

      {/* ------------------------------ rodapé ------------------------------ */}
      <footer className="border-t border-white/5 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-4 text-xs text-white/35 sm:flex-row sm:items-center sm:px-6">
          <p className="flex items-center gap-2">
            <Gavel className="h-3.5 w-3.5 text-volt/60" />
            LicitaPreço — apoio à pesquisa de preços (Lei nº 14.133/21, art. 5º, XV)
          </p>
          <p>Confirme sempre preço, frete e disponibilidade no anúncio antes de formalizar a cotação.</p>
        </div>
      </footer>
    </>
  );
}
