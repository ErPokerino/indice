import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpDown,
  BarChart3,
  Check,
  Copy,
  Download,
  FileCheck2,
  FileText,
  MessageSquarePlus,
  Search,
  Table2,
} from "lucide-react";
import {
  downloadBlob,
  downloadText,
  type ChartData,
  type CompiledDocument,
  type RichTableData,
  type Source,
} from "./types";

const PALETTE = ["#224fe0", "#0f766e", "#b45309", "#6d28d9", "#be123c", "#1d4ed8"];

function csvEscape(v: string) {
  return `"${String(v ?? "").replaceAll('"', '""')}"`;
}

function renderCellWithCitations(
  cell: string,
  sources: Source[],
  onSource: (s: Source) => void,
) {
  const badgeMatch = cell.trim().match(/^(alto|critico|medio|attenzione|basso|conforme)$/i);
  if (badgeMatch) {
    const val = badgeMatch[1].toLowerCase();
    const cls =
      val === "alto" || val === "critico"
        ? "risk-high"
        : val === "medio" || val === "attenzione"
          ? "risk-mid"
          : "risk-low";
    return <span className={"status-pill " + cls}>{cell}</span>;
  }
  const parts = cell.split(/(\[\d+\])/g);
  return parts.map((p, idx) => {
    const m = p.match(/^\[(\d+)\]$/);
    const s = m && sources[Number(m[1]) - 1];
    if (m && s) {
      return (
        <sup key={idx}>
          <button
            type="button"
            className="inline-cite"
            onClick={() => onSource(s)}
            aria-label={"Fonte " + m[1] + ", " + s.name}
          >
            [{m[1]}]
          </button>
        </sup>
      );
    }
    return <span key={idx}>{p}</span>;
  });
}

export function RichTable({
  table,
  sources,
  onSource,
}: {
  table: RichTableData;
  sources: Source[];
  onSource: (s: Source) => void;
}) {
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = table.rows;
    if (q) {
      list = list.filter((row) =>
        row.some((c) => c.toLowerCase().includes(q)),
      );
    }
    if (sortCol !== null) {
      list = [...list].sort((a, b) => {
        const av = a[sortCol] || "";
        const bv = b[sortCol] || "";
        const an = Number(av.replace(",", "."));
        const bn = Number(bv.replace(",", "."));
        const cmp =
          !Number.isNaN(an) && !Number.isNaN(bn) && av.trim() !== "" && bv.trim() !== ""
            ? an - bn
            : av.localeCompare(bv, "it");
        return sortAsc ? cmp : -cmp;
      });
    }
    return list;
  }, [table.rows, filter, sortCol, sortAsc]);

  function exportCsv() {
    const lines = [
      table.columns.map(csvEscape).join(";"),
      ...filtered.map((r) => r.map(csvEscape).join(";")),
    ];
    downloadText("\ufeff" + lines.join("\n"), `${table.title || "tabella"}.csv`, "text/csv;charset=utf-8");
  }

  async function copyMd() {
    const sep = "| " + table.columns.map(() => "---").join(" | ") + " |";
    const body = filtered.map((r) => "| " + r.join(" | ") + " |").join("\n");
    const md = "| " + table.columns.join(" | ") + " |\n" + sep + "\n" + body;
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="data-card">
      <div className="data-card-head">
        <div className="data-card-title">
          <Table2 size={16} />
          <div>
            <strong>{table.title}</strong>
            {table.description && <small>{table.description}</small>}
          </div>
        </div>
        <div className="data-card-actions">
          <span className="count-pill">{filtered.length} righe</span>
          <button type="button" className="mini-btn" onClick={() => void copyMd()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copiata" : "Copia"}
          </button>
          <button type="button" className="mini-btn" onClick={exportCsv}>
            <Download size={13} />
            CSV
          </button>
        </div>
      </div>
      {table.rows.length >= 4 && (
        <div className="table-filter">
          <Search size={13} />
          <input
            aria-label={"Filtra " + table.title}
            placeholder="Filtra righe…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      <div className="table-scroll">
        <table className="rich-table">
          <thead>
            <tr>
              {table.columns.map((col, idx) => (
                <th key={idx} scope="col">
                  <button
                    type="button"
                    className="sort-col"
                    onClick={() => {
                      if (sortCol === idx) setSortAsc(!sortAsc);
                      else {
                        setSortCol(idx);
                        setSortAsc(true);
                      }
                    }}
                  >
                    {col}
                    <ArrowUpDown size={11} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, rIdx) => (
              <tr key={rIdx}>
                {table.columns.map((_, cIdx) => (
                  <td key={cIdx}>
                    {renderCellWithCitations(row[cIdx] ?? "", sources, onSource)}
                  </td>
                ))}
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={table.columns.length} className="muted">
                  Nessuna riga corrisponde al filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ChartCard({ chart }: { chart: ChartData }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const maxVal = Math.max(1, ...chart.data.map((d) => Math.abs(d.value)));
  const totalVal = Math.max(
    1,
    chart.data.reduce((acc, d) => acc + Math.max(0, d.value), 0),
  );

  function downloadSvg() {
    if (!svgRef.current) return;
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    downloadBlob(
      new Blob([xml], { type: "image/svg+xml;charset=utf-8" }),
      `${chart.title || "grafico"}.svg`,
    );
  }

  return (
    <section className="data-card">
      <div className="data-card-head">
        <div className="data-card-title">
          <BarChart3 size={16} />
          <div>
            <strong>{chart.title}</strong>
            {chart.subtitle && <small>{chart.subtitle}</small>}
          </div>
        </div>
        <div className="data-card-actions">
          {chart.type !== "timeline" && (
            <button type="button" className="mini-btn" onClick={downloadSvg}>
              <Download size={13} />
              SVG
            </button>
          )}
        </div>
      </div>

      {chart.type === "timeline" ? (
        <ol className="timeline-list">
          {chart.data.map((d, i) => (
            <li key={i} className="timeline-item">
              <span className="timeline-dot" />
              <div className="timeline-body">
                {d.date && <span className="timeline-date">{d.date}</span>}
                <strong>{d.label}</strong>
                {d.note && <p>{d.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      ) : chart.type === "donut" ? (
        <div className="donut-wrap">
          <svg
            ref={svgRef}
            viewBox="0 0 220 220"
            className="chart-svg donut-svg"
            role="img"
            aria-label={chart.title}
          >
            {(() => {
              const r = 72;
              const c = 2 * Math.PI * r;
              let offset = 0;
              return chart.data.map((d, i) => {
                const frac = Math.max(0, d.value) / totalVal;
                const dash = frac * c;
                const el = (
                  <circle
                    key={i}
                    cx="110"
                    cy="110"
                    r={r}
                    fill="none"
                    stroke={PALETTE[i % PALETTE.length]}
                    strokeWidth={active === i ? 30 : 26}
                    strokeDasharray={`${dash} ${c - dash}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 110 110)"
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                  />
                );
                offset += dash;
                return el;
              });
            })()}
            <text x="110" y="106" textAnchor="middle" className="svg-total">
              {active !== null
                ? chart.data[active].value.toLocaleString("it-IT")
                : totalVal.toLocaleString("it-IT")}
            </text>
            <text x="110" y="124" textAnchor="middle" className="svg-sub">
              {active !== null ? chart.data[active].label.slice(0, 18) : chart.unit || "Totale"}
            </text>
          </svg>
          <ul className="chart-legend">
            {chart.data.map((d, i) => (
              <li
                key={i}
                className={active === i ? "on" : ""}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              >
                <i style={{ background: PALETTE[i % PALETTE.length] }} />
                <span>{d.label}</span>
                <strong>
                  {d.value.toLocaleString("it-IT")}
                  {chart.unit ? ` ${chart.unit}` : ""}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      ) : chart.type === "horizontal_bar" ? (
        <svg
          ref={svgRef}
          viewBox={`0 0 560 ${Math.max(120, chart.data.length * 46 + 24)}`}
          className="chart-svg"
          role="img"
          aria-label={chart.title}
        >
          {chart.data.map((d, i) => {
            const y = 18 + i * 44;
            const barW = Math.max(8, (Math.abs(d.value) / maxVal) * 290);
            return (
              <g
                key={i}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              >
                <text x="6" y={y + 18} className="svg-label">
                  {d.label.length > 26 ? d.label.slice(0, 25) + "…" : d.label}
                </text>
                <rect x="195" y={y + 4} width="290" height="20" rx="4" fill="#eef2f8" />
                <rect
                  x="195"
                  y={y + 4}
                  width={barW}
                  height="20"
                  rx="4"
                  fill={PALETTE[i % PALETTE.length]}
                  opacity={active === null || active === i ? 1 : 0.55}
                />
                <text x="492" y={y + 19} className="svg-val">
                  {d.value.toLocaleString("it-IT")}
                  {chart.unit ? ` ${chart.unit}` : ""}
                </text>
              </g>
            );
          })}
        </svg>
      ) : chart.type === "line" ? (
        <svg
          ref={svgRef}
          viewBox="0 0 560 220"
          className="chart-svg"
          role="img"
          aria-label={chart.title}
        >
          <line x1="46" y1="20" x2="46" y2="174" stroke="#dce2ea" />
          <line x1="46" y1="174" x2="532" y2="174" stroke="#dce2ea" />
          {(() => {
            const pts = chart.data.map((d, i) => {
              const x =
                chart.data.length === 1
                  ? 280
                  : 68 + (i * 440) / Math.max(1, chart.data.length - 1);
              const y = 164 - (Math.max(0, d.value) / maxVal) * 128;
              return { x, y, d };
            });
            const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
            return (
              <>
                <polyline
                  fill="none"
                  stroke="#224fe0"
                  strokeWidth="2.5"
                  points={poly}
                />
                {pts.map((p, i) => (
                  <g
                    key={i}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                  >
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={active === i ? 6 : 4.5}
                      fill="#224fe0"
                      stroke="#fff"
                      strokeWidth="2"
                    />
                    <text x={p.x} y={p.y - 10} textAnchor="middle" className="svg-val">
                      {p.d.value.toLocaleString("it-IT")}
                    </text>
                    <text x={p.x} y="194" textAnchor="middle" className="svg-label">
                      {p.d.label.length > 14 ? p.d.label.slice(0, 13) + "…" : p.d.label}
                    </text>
                  </g>
                ))}
              </>
            );
          })()}
        </svg>
      ) : (
        <svg
          ref={svgRef}
          viewBox="0 0 560 230"
          className="chart-svg"
          role="img"
          aria-label={chart.title}
        >
          {[0.25, 0.5, 0.75, 1].map((f) => {
            const y = 172 - f * 136;
            return (
              <line key={f} x1="42" y1={y} x2="540" y2={y} stroke="#eef2f7" />
            );
          })}
          <line x1="42" y1="172" x2="540" y2="172" stroke="#cfd8e5" />
          {chart.data.map((d, i) => {
            const slot = 480 / Math.max(1, chart.data.length);
            const barW = Math.min(68, slot * 0.56);
            const x = 52 + i * slot + (slot - barW) / 2;
            const h = Math.max(4, (Math.max(0, d.value) / maxVal) * 136);
            const y = 172 - h;
            return (
              <g
                key={i}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              >
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx="5"
                  fill={PALETTE[i % PALETTE.length]}
                  opacity={active === null || active === i ? 1 : 0.6}
                />
                <text x={x + barW / 2} y={y - 7} textAnchor="middle" className="svg-val">
                  {d.value.toLocaleString("it-IT")}
                  {chart.unit ? ` ${chart.unit}` : ""}
                </text>
                <text x={x + barW / 2} y="192" textAnchor="middle" className="svg-label">
                  {d.label.length > 18 ? d.label.slice(0, 17) + "…" : d.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && chart.data[active]?.note && (
        <p className="chart-tooltip">{chart.data[active].note}</p>
      )}
    </section>
  );
}

export function CompiledDocumentCard({
  doc,
  onRefine,
}: {
  doc: CompiledDocument;
  onRefine?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState("");

  async function copyText() {
    await navigator.clipboard.writeText(doc.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function exportDocx() {
    setExporting(true);
    setExportErr("");
    try {
      const res = await fetch("/api/export/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: doc.title, content: doc.content }),
      });
      if (!res.ok) throw new Error("Esportazione DOCX non riuscita.");
      const blob = await res.blob();
      downloadBlob(blob, `${doc.title || "documento"}.docx`);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Errore esportazione.");
    } finally {
      setExporting(false);
    }
  }

  const compiledCount = doc.compiledFields?.length || 0;
  const missingCount = doc.missingFields?.length || 0;

  return (
    <section className="doc-card">
      <div className="doc-card-head">
        <div className="data-card-title">
          <FileCheck2 size={18} />
          <div>
            <strong>{doc.title}</strong>
            <small>
              {doc.templateName ? `${doc.templateName} · ` : ""}
              {compiledCount} campi compilati
              {missingCount > 0 ? ` · ${missingCount} da completare` : " · Completo"}
            </small>
          </div>
        </div>
        <div className="data-card-actions">
          <button type="button" className="mini-btn" onClick={() => void copyText()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copiato" : "Copia"}
          </button>
          <button
            type="button"
            className="mini-btn"
            onClick={() =>
              downloadText(doc.content, `${doc.title || "documento"}.md`, "text/markdown;charset=utf-8")
            }
          >
            <FileText size={13} />
            MD
          </button>
          <button
            type="button"
            className="mini-btn primary-mini"
            disabled={exporting}
            onClick={() => void exportDocx()}
          >
            <Download size={13} />
            {exporting ? "DOCX…" : "DOCX"}
          </button>
          {onRefine && (
            <button type="button" className="mini-btn" onClick={onRefine}>
              <MessageSquarePlus size={13} />
              Affina in chat
            </button>
          )}
        </div>
      </div>

      {missingCount > 0 && (
        <div className="doc-missing-banner">
          Dati ancora da integrare in chat: {doc.missingFields!.join(", ")}
        </div>
      )}
      {exportErr && <p role="alert">{exportErr}</p>}
      <div className="doc-preview-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
      </div>
    </section>
  );
}
