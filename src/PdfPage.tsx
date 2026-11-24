import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Source } from "./types";
GlobalWorkerOptions.workerSrc = worker;

export default function PdfPage({
  id,
  page,
  source,
}: {
  id: number;
  page: number;
  source?: Source | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [ratio, setRatio] = useState(400 / 505);
  const [issue, setIssue] = useState("");
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    let active = true;
    setPdf(undefined);
    setIssue("");
    const assets = import.meta.env.DEV
      ? "/node_modules/pdfjs-dist/"
      : "/pdfjs/";
    const task = getDocument({
      url: "/api/docs/" + id + "/original",
      useSystemFonts: true,
      cMapUrl: assets + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: assets + "standard_fonts/",
      wasmUrl: assets + "wasm/",
      iccUrl: assets + "iccs/",
    });
    task.promise
      .then((doc) => {
        if (active) setPdf(doc);
      })
      .catch(() => {
        if (active) setIssue("Impossibile leggere il PDF.");
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [id]);
  useEffect(() => {
    let active = true;
    let render: RenderTask | undefined;
    setRendered(false);
    if (pdf && canvas.current) {
      const el = canvas.current;
      pdf
        .getPage(page)
        .then(async (item) => {
          if (!active) return;
          const frame = item.getViewport({ scale: 1 });
          const width =
            Math.max(620, el.parentElement?.clientWidth || 0) *
            Math.min(window.devicePixelRatio || 1, 2);
          const vp = item.getViewport({ scale: width / frame.width });
          el.width = Math.ceil(vp.width);
          el.height = Math.ceil(vp.height);
          setRatio(vp.width / vp.height);
          render = item.render({ canvas: el, viewport: vp });
          await render.promise;
          if (active) setRendered(true);
        })
        .catch(() => {
          if (active) setIssue("Pagina non disponibile.");
        });
    }
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, page]);
  if (issue)
    return (
      <p role="alert">
        {issue}{" "}
        <a
          href={"/api/docs/" + id + "/original"}
          target="_blank"
          rel="noreferrer"
        >
          Apri originale
        </a>
      </p>
    );
  return (
    <div className="pdf-page" style={{ aspectRatio: ratio }}>
      <canvas ref={canvas} aria-label={"Documento originale, pagina " + page} />
      {rendered &&
        source?.page === page &&
        source.rects.map(([x, y, x2, y2], i) => (
          <span
            aria-hidden="true"
            className="highlight"
            key={i}
            style={{
              left: x * 100 + "%",
              top: y * 100 + "%",
              width: (x2 - x) * 100 + "%",
              height: (y2 - y) * 100 + "%",
            }}
          />
        ))}
    </div>
  );
}
