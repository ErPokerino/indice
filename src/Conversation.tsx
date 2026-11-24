import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Cpu, FileText, ListTree } from "lucide-react";
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

export function Conversation({
  turn,
  onSource,
  details,
  onRefineDocument,
}: {
  turn: Turn;
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

  return (
    <article className="turn">
      <div className="user-message">{turn.question}</div>
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
              className="source-link"
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
    </article>
  );
}
