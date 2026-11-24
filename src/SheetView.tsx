import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Source } from "./types";
import { IconButton } from "./ui";

type Sheet = Map<number, Map<string, { value: string; ids: number[] }>>;

export function SheetView({
  parts,
  source,
}: {
  parts: Source[];
  source: Source | null;
}) {
  const sheets = useMemo(() => {
    const all = new Map<string, Sheet>();
    for (const part of parts) {
      const match = part.label.match(/^(?:(.*)!)?([A-Z]+)(\d+)$/);
      if (!match) continue;
      const name = match[1] || "CSV",
        row = Number(match[3]),
        col = match[2];
      const sheet = all.get(name) || new Map(),
        line = sheet.get(row) || new Map();
      const cell = line.get(col) || { value: "", ids: [] };
      cell.value += part.quote;
      cell.ids.push(part.id);
      line.set(col, cell);
      sheet.set(row, line);
      all.set(name, sheet);
    }
    return all;
  }, [parts]);
  const [tab, setTab] = useState(""),
    [section, setSection] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const name = sheets.has(tab) ? tab : sheets.keys().next().value || "";
  const sheet = sheets.get(name);
  const rows = Array.from(sheet?.keys() || []).sort((a, b) => a - b);
  const visible = rows.slice(section * 25, (section + 1) * 25);
  const cols = Array.from(
    new Set(visible.flatMap((r) => Array.from(sheet!.get(r)!.keys()))),
  ).sort((a, b) => a.length - b.length || a.localeCompare(b));
  useEffect(() => {
    if (!source) return;
    const match = source.label.match(/^(?:(.*)!)?[A-Z]+(\d+)$/);
    if (!match) return;
    const target = match[1] || "CSV",
      row = Number(match[2]);
    setTab(target);
    const position = Array.from(sheets.get(target)?.keys() || [])
      .sort((a, b) => a - b)
      .indexOf(row);
    setSection(Math.max(0, Math.floor(position / 25)));
  }, [source, sheets]);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>("[data-active=true]");
    if (el && box.current) {
      box.current.scrollLeft = Math.max(0, el.offsetLeft - 70);
      box.current.scrollTop = Math.max(0, el.offsetTop - 40);
    }
  }, [rows.length, source, tab, section]);
  if (!sheet) return <p className="muted">Apertura del foglio…</p>;
  return (
    <>
      <div className="sheet-toolbar">
        <select
          aria-label="Foglio di lavoro"
          value={name}
          onChange={(e) => {
            setTab(e.target.value);
            setSection(0);
          }}
        >
          {[...sheets.keys()].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        {rows.length > 25 && (
          <>
            <IconButton
              label="Righe precedenti"
              disabled={!section}
              onClick={() => setSection((n) => n - 1)}
            >
              <ChevronLeft />
            </IconButton>
            <IconButton
              label="Righe successive"
              disabled={(section + 1) * 25 >= rows.length}
              onClick={() => setSection((n) => n + 1)}
            >
              <ChevronRight />
            </IconButton>
          </>
        )}
      </div>
      <div className="extract sheet-view" ref={box}>
        <table aria-label={"Foglio " + name}>
          <thead>
            <tr>
              <th scope="col">#</th>
              {cols.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r}>
                <th scope="row">{r}</th>
                {cols.map((c) => {
                  const v = sheet.get(r)?.get(c);
                  return (
                    <td
                      key={c}
                      data-active={!!source && v?.ids.includes(source.id)}
                    >
                      {v?.value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
