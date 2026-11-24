import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Cpu, FileCheck2, FileText, ListTree } from "lucide-react";
import { ChartCard, CompiledDocumentCard, RichTable } from "./DataViews";
import { type ChartData, type Source, type Turn } from "./types";

function parseChartCodeBlock(raw: string): ChartData | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.data) && parsed.title) {
      return parsed as ChartData;
    }
  } catch {
    return null;
  }
  return null;
}

const STRATEGY_LABEL: Record<string, string> = {
  exact_clause: "Clausola esatta",
  cell_range: "Celle",
  semantic_concept: "Ricerca ibrida",
  document_summary: "Sintesi",
  full_document: "Documento intero",
};

export function Conversation({
  turn,
  activeSourceId,
  onSource,
  details,
  onRefineDocument,
}: {
  turn: Turn;
  activeSourceId?: number | null;
  onSource: (s: Source) => void;
  details: () => void;
  onRefineDocument?: (turn: Turn) => void;
}) {
  const [copied, setCopied] = useState(false);
  const markdown = turn.text.replace(/\[(\d+)\](?!\()/g, (raw, n) =>
    turn.sources[Number(n) - 1] ? "[" + n + "](#fonte-" + n + ")" : raw,
  );

  async function copyAnswer() {
    await navigator.clipboard.writeText(turn.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const modeLabel =
    turn.mode === "example"
      ? "Esempio della pratica"
      : turn.mode === "local"
        ? "Estratti locali"
        : turn.model === "gemini-4-neon"
          ? "Gemini · Neon"
          : "Gemini · Hydrogen";

  return (
    <article className="turn">
      <div className="user-row">
        <div className="user-message">{turn.question}</div>
      </div>

      <div className="assistant-card">
        <div className="assistant-head">
          <span className="assistant-monogram" aria-hidden="true">
            I
          </span>
          <span className="assistant-mode">{modeLabel}</span>
          {turn.template && (
            <span className="assistant-tpl-pill">
              <FileCheck2 size={12} />
              {turn.template.name}
            </span>
          )}
          {turn.plan && turn.plan.length > 0 && (
            <div className="plan-pills">
              {turn.plan.slice(0, 3).map((p, idx) => (
                <span className="plan-pill" key={idx} title={p.reason}>
                  {STRATEGY_LABEL[p.strategy] || p.strategy}
                  {p.docFilter ? ` · ${p.docFilter.replace(/\.[^.]+$/, "")}` : ""}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="answer">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img: ({ alt }) => <span>{alt}</span>,
              table: ({ children }) => (
                <div className="table-scroll">
                  <table>{children}</table>
                </div>
              ),
              code: ({ className, children, ...props }) => {
                const lang = className || "";
                const content = String(children ?? "").trim();
                if (lang.includes("language-chart")) {
                  const parsed = parseChartCodeBlock(content);
                  if (parsed) return <ChartCard chart={parsed} />;
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
              a: ({ href, children }) => {
                const n = href?.match(/^#fonte-(\d+)$/);
                const s = n && turn.sources[Number(n[1]) - 1];
                return s ? (
                  <sup>
                    <button
                      type="button"
                      onClick={() => onSource(s)}
                      aria-label={"Fonte " + n[1] + ", " + s.name}
                    >
                      [{n[1]}]
                    </button>
                  </sup>
                ) : (
                  <span>{children}</span>
                );
              },
            }}
          >
            {markdown}
          </ReactMarkdown>
        </div>

        {turn.document && (
          <CompiledDocumentCard
            doc={turn.document}
            onRefine={onRefineDocument ? () => onRefineDocument(turn) : undefined}
          />
        )}

        {turn.tables?.map((t, idx) => (
          <RichTable key={idx} table={t} sources={turn.sources} onSource={onSource} />
        ))}

        {turn.charts?.map((c, idx) => (
          <ChartCard key={idx} chart={c} />
        ))}

        {turn.sources.length > 0 && (
          <div className="citations">
            {turn.sources.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => onSource(s)}
                className={
                  "source-link " + (activeSourceId === s.id ? "active-source" : "")
                }
              >
                <FileText />
                {s.name.replace(/\.[^.]+$/, "")} · {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="turn-footer">
          <button type="button" className="turn-meta" onClick={details}>
            <ListTree size={13} />
            {turn.mode === "example"
              ? "Esempio della pratica"
              : turn.mode === "local"
                ? "Estratti locali"
                : "Gemini"}
            <span>·</span>Dettagli
          </button>
          {turn.plan && turn.plan.length > 0 && (
            <button
              type="button"
              className="turn-badge"
              onClick={details}
              title="Apri piano multi-retrieval"
            >
              <Cpu size={12} />
              {turn.plan.length} {turn.plan.length === 1 ? "strategia" : "strategie"}
            </button>
          )}
          <button
            type="button"
            className="turn-meta copy-turn"
            onClick={() => void copyAnswer()}
            aria-label="Copia risposta"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copiata" : "Copia"}
          </button>
        </div>
      </div>
    </article>
  );
}
