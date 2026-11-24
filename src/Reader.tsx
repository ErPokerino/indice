import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize2,
} from "lucide-react";
import { api, err, type Doc, type Source } from "./types";
import { IconButton, Modal } from "./ui";
import { SheetView } from "./SheetView";
const PdfPage = lazy(() => import("./PdfPage"));

export function Reader({
  doc,
  source,
  expanded = false,
}: {
  doc: Doc;
  source: Source | null;
  expanded?: boolean;
}) {
  const [page, setPage] = useState(source?.page || 1);
  const [large, setLarge] = useState(false);
  const [parts, setParts] = useState<Source[]>([]);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const pdf = doc.mime === "application/pdf",
    image = doc.mime.startsWith("image/");
  useEffect(() => {
    setPage(source?.page || 1);
  }, [doc.id, source]);
  useEffect(() => {
    setParts([]);
    setError("");
    if (pdf || image) return;
    const ctrl = new AbortController();
    api<Source[]>(
      "/docs/" + doc.id + "/passages",
      "GET",
      undefined,
      ctrl.signal,
    )
      .then(setParts)
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(err(e));
      });
    return () => ctrl.abort();
  }, [doc.id, pdf, image]);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (el && box.current) box.current.scrollTop = el.offsetTop - 10;
  }, [parts, source]);
  const body = (
    <>
      <div className="reader-paper">
        {pdf ? (
          <Suspense fallback={<p className="muted">Apertura PDF…</p>}>
            <PdfPage key={doc.id} id={doc.id} page={page} source={source} />
          </Suspense>
        ) : image ? (
          <img
            className="source-image"
            src={"/api/docs/" + doc.id + "/original"}
            alt={doc.name}
          />
        ) : /\.(xlsx|csv)$/i.test(doc.name) && !error ? (
          <SheetView parts={parts} source={source} />
        ) : (
          <div ref={box} className="extract">
            {parts.map((p) => (
              <div data-active={p.id === source?.id} key={p.id}>
                <small>{p.label}</small>
                <p>{p.quote}</p>
              </div>
            ))}
            {error && <p role="alert">{error}</p>}
          </div>
        )}
      </div>
      <div className="reader-controls">
        <span>
          {pdf
            ? "Pagina " + page + " di " + doc.pages
            : image
              ? "Immagine originale"
              : "Contenuto estratto"}
        </span>
        <div>
          {pdf && (
            <>
              <IconButton
                label="Pagina precedente"
                disabled={page <= 1}
                onClick={() => setPage((n) => n - 1)}
              >
                <ChevronLeft />
              </IconButton>
              <IconButton
                label="Pagina successiva"
                disabled={page >= doc.pages}
                onClick={() => setPage((n) => n + 1)}
              >
                <ChevronRight />
              </IconButton>
            </>
          )}
          {!expanded && (
            <IconButton
              label="Ingrandisci documento"
              onClick={() => setLarge(true)}
            >
              <Maximize2 />
            </IconButton>
          )}
          <a
            className="icon-btn"
            href={"/api/docs/" + doc.id + "/original"}
            target="_blank"
            rel="noreferrer"
            aria-label="Apri originale"
            title="Apri originale"
          >
            <ExternalLink />
          </a>
        </div>
      </div>
      {(doc.visualPages.includes(page) || image) && (
        <p className="muted">Questa fonte richiede verifica visiva.</p>
      )}
    </>
  );
  return (
    <>
      {body}
      {large && (
        <Modal title={doc.name} wide onClose={() => setLarge(false)}>
          <Reader
            doc={doc}
            source={
              source && (!pdf || source.page === page)
                ? source
                : {
                    id: 0,
                    doc: doc.id,
                    name: doc.name,
                    label: "",
                    page,
                    quote: "",
                    rects: [],
                    visual: false,
                  }
            }
            expanded
          />
        </Modal>
      )}
    </>
  );
}
