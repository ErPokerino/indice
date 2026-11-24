import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  AudioLines,
  BookOpen,
  Check,
  ChevronRight,
  ChevronsUpDown,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FileStack,
  FileText,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Menu,
  MessageSquare,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
  Settings as Gear,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  err,
  fmt,
  type Config,
  type Doc,
  type Meter,
  type Session,
  type Source,
  type Studio,
  type Template,
  type Turn,
} from "./types";
import { Brand, ConfirmModal, IconButton, Modal, Picker } from "./ui";
import {
  DocumentModels,
  FoldersPanel,
  Practices,
  SearchPanel,
  Settings,
  UploadPanel,
} from "./Panels";
import { Reader } from "./Reader";
import { Conversation } from "./Conversation";
import "./styles.css";

type Panel =
  | "settings"
  | "models"
  | "practices"
  | "folders"
  | "upload"
  | "search"
  | "voice"
  | "context"
  | "nav"
  | "sources"
  | "details"
  | null;

const OUTPUT_MODES = {
  auto: "Auto",
  table: "Tabella",
  chart: "Grafico",
  document: "Documento",
};

function App() {
  const [studio, setStudio] = useState<Studio | null>(null),
    [s, setSession] = useState<Session | null>(null),
    [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState(""),
    [scope, setScope] = useState(false),
    [tpl, setTpl] = useState<Template | null>(null),
    [keepTpl, setKeepTpl] = useState(true),
    [showFields, setShowFields] = useState(false),
    [fieldValues, setFieldValues] = useState<Record<string, string>>({}),
    [outputMode, setOutputMode] = useState<"auto" | "table" | "chart" | "document">("auto"),
    [file, setFile] = useState<number | null>(null),
    [source, setSource] = useState<Source | null>(null);
  const [tab, setTab] = useState<"selected" | "all" | "folders">("selected"),
    [docFilter, setDocFilter] = useState(""),
    [meter, setMeter] = useState<Meter | null>(null),
    [meterError, setMeterError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<Turn | null>(null),
    [version, setVersion] = useState<Config | null>(null),
    [deleteSessionTarget, setDeleteSessionTarget] = useState<{
      id: number;
      title: string;
    } | null>(null),
    [deleteDocTarget, setDeleteDocTarget] = useState<Doc | null>(null),
    [newMatterName, setNewMatterName] = useState("");
  const rail = useRef<HTMLDivElement>(null),
    draft = useRef<HTMLTextAreaElement>(null),
    active = useRef(0),
    nonce = useRef(""),
    errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const block = busy || editing;

  function report(e: unknown) {
    setError(err(e));
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(""), 14000);
  }

  async function refresh() {
    const st = await api<Studio>("/studio");
    setStudio(st);
    return st;
  }

  async function load(id: number) {
    const ticket = ++active.current;
    setEditing(true);
    try {
      const next = await api<Session>("/sessions/" + id);
      if (ticket !== active.current) return;
      localStorage.setItem("indice.session", String(id));
      setSession(next);
      setText("");
      setScope(false);
      setTpl(null);
      setFieldValues({});
      setShowFields(false);
      setOutputMode("auto");
      setError("");
      setMeter(null);
      setTab("selected");
      setPanel(null);
      nonce.current = "";
      const cited = next.turns.at(-1)?.sources.at(-1) || null;
      setFile(cited?.doc || next.selected[0] || null);
      setSource(cited);
      requestAnimationFrame(() => {
        if (rail.current) rail.current.scrollTop = rail.current.scrollHeight;
      });
    } finally {
      if (ticket === active.current) setEditing(false);
    }
  }

  async function reloadCurrentSession() {
    const st = await refresh();
    if (s && st.sessions.some((x) => x.id === s.id)) {
      const next = await api<Session>("/sessions/" + s.id);
      setSession(next);
    }
  }

  async function boot() {
    try {
      const st = await refresh();
      if (!st.sessions.length) {
        setSession(null);
        return;
      }
      const saved = Number(localStorage.getItem("indice.session"));
      await load(
        st.sessions.find((i) => i.id === saved)?.id || st.sessions.at(-1)!.id,
      );
    } catch (e) {
      report(e);
    }
  }

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    const el = draft.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(200, Math.max(40, el.scrollHeight)) + "px";
  }, [text]);

  useEffect(() => {
    if (!s) return;
    const ctrl = new AbortController();
    setMeter(null);
    setMeterError("");
    const timer = setTimeout(
      () => {
        api<Meter>(
          "/sessions/" + s.id + "/context",
          "POST",
          {
            question: text,
            archive: scope,
            template: tpl?.id,
            field_values: fieldValues,
            output_mode: outputMode,
          },
          ctrl.signal,
        )
          .then(setMeter)
          .catch((e) => {
            if (!ctrl.signal.aborted) setMeterError(err(e));
          });
      },
      text ? 800 : 90,
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [
    s?.id,
    s?.revision,
    text,
    scope,
    tpl?.id,
    outputMode,
    studio?.settings.version,
    studio?.templates,
  ]);

  useEffect(() => {
    nonce.current = "";
  }, [s?.revision, text, scope, tpl?.id, outputMode]);

  if (!studio) {
    return (
      <main className="loading">
        <Brand />
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => void boot()}>Riprova</button>
          </>
        ) : (
          <p>Apertura dello studio…</p>
        )}
      </main>
    );
  }

  const st = studio;

  if (!s) {
    async function createFirstMatter() {
      if (!newMatterName.trim() || editing) return;
      setEditing(true);
      try {
        const r = await api<{ session: number }>("/matters", "POST", {
          name: newMatterName.trim(),
        });
        setNewMatterName("");
        await refresh();
        await load(r.session);
      } catch (e) {
        report(e);
      } finally {
        setEditing(false);
      }
    }
    return (
      <main className="empty-workspace">
        <Brand />
        <h1>Nessuna pratica aperta</h1>
        <p className="muted">
          Crea una nuova pratica per archiviare documenti, collegare cartelle di
          retrieval e generare atti legali.
        </p>
        <form
          className="create-form inline-create"
          onSubmit={(e) => {
            e.preventDefault();
            void createFirstMatter();
          }}
        >
          <input
            placeholder="Nome della nuova pratica"
            value={newMatterName}
            onChange={(e) => setNewMatterName(e.target.value)}
            required
          />
          <button className="primary" disabled={editing || !newMatterName.trim()}>
            <FolderPlus size={16} />
            Crea pratica
          </button>
        </form>
        <div className="empty-links">
          <button type="button" className="outline" onClick={() => setPanel("settings")}>
            <Gear size={15} />
            Configurazione e chiave API
          </button>
          <button type="button" className="outline" onClick={() => setPanel("models")}>
            <FileStack size={15} />
            Modelli di documenti
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {panel === "settings" && (
          <Settings
            studio={st}
            done={refreshThenVoid}
            close={() => setPanel(null)}
          />
        )}
        {panel === "models" && (
          <DocumentModels
            studio={st}
            refresh={refreshThenVoid}
            close={() => setPanel(null)}
            useTemplate={() => setPanel(null)}
          />
        )}
      </main>
    );
  }

  const session = s;
  const matter = st.matters.find((m) => m.id === session.matter) || {
    id: session.matter,
    name: "Pratica",
  };
  const doc = session.docs.find((d) => d.id === file);
  const folders = session.folders || [];
  const activeFoldersCount = folders.filter((f) => f.enabled).length;
  const qFilter = docFilter.trim().toLowerCase();
  const docs = (
    tab === "all"
      ? session.docs
      : session.docs.filter((d) => session.selected.includes(d.id))
  ).filter(
    (d) =>
      !qFilter ||
      d.name.toLowerCase().includes(qFilter) ||
      (d.folderLabel || "").toLowerCase().includes(qFilter),
  );
  const tplFields = tpl
    ? tpl.fields
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
  const pct = meter ? (100 * meter.used) / meter.limit : 0;
  const percent = meter
    ? (pct > 0 && pct < 0.1
        ? "< 0,1"
        : pct.toLocaleString("it-IT", { maximumFractionDigits: 1 })) + "%"
    : "…";

  function openSource(x: Source) {
    setSource({ ...x });
    setFile(x.doc);
    setTab(session.selected.includes(x.doc) ? "selected" : "all");
    setPanel(
      window.matchMedia("(max-width: 1050px)").matches ? "sources" : null,
    );
  }

  function chooseDoc(d: Doc) {
    setFile(d.id);
    setSource(null);
  }

  async function update(
    patch: Partial<Pick<Session, "selected" | "model" | "level">>,
  ) {
    if (block) return;
    setEditing(true);
    try {
      const next = await api<Session>("/sessions/" + session.id, "PUT", {
        model: session.model,
        level: session.level,
        selected: session.selected,
        revision: session.revision,
        ...patch,
      });
      setSession(next);
    } finally {
      setEditing(false);
    }
  }

  async function toggleDoc(id: number) {
    await update({
      selected: session.selected.includes(id)
        ? session.selected.filter((i) => i !== id)
        : [...session.selected, id],
    });
  }

  async function activate(id: number) {
    await refresh();
    await load(id);
  }

  async function handleMatterDeleted(nextSessionId: number | null) {
    setPanel(null);
    const nextStudio = await refresh();
    if (nextSessionId) {
      await load(nextSessionId);
    } else if (nextStudio.sessions.length) {
      await load(nextStudio.sessions[0].id);
    } else {
      localStorage.removeItem("indice.session");
      setSession(null);
    }
  }

  async function confirmDeleteSession() {
    if (!deleteSessionTarget) return;
    setEditing(true);
    try {
      const r = await api<{ deleted: number; nextSession: number }>(
        `/sessions/${deleteSessionTarget.id}`,
        "DELETE",
      );
      setDeleteSessionTarget(null);
      await refresh();
      if (deleteSessionTarget.id === session.id || !st.sessions.some((x) => x.id === session.id)) {
        await load(r.nextSession);
      }
    } catch (e) {
      report(e);
    } finally {
      setEditing(false);
    }
  }

  async function confirmDeleteDoc() {
    if (!deleteDocTarget) return;
    setEditing(true);
    try {
      await api(`/docs/${deleteDocTarget.id}`, "DELETE");
      setDeleteDocTarget(null);
      await reloadCurrentSession();
    } catch (e) {
      report(e);
    } finally {
      setEditing(false);
    }
  }

  async function newChat() {
    if (block) return;
    setEditing(true);
    try {
      const r = await api<{ id: number }>(
        "/matters/" + session.matter + "/sessions",
        "POST",
        { name: "Nuova conversazione" },
      );
      await activate(r.id);
      setTimeout(() => draft.current?.focus(), 100);
    } catch (e) {
      report(e);
    } finally {
      setEditing(false);
    }
  }

  async function send() {
    if (block || !text.trim() || pct > 100) return;
    setBusy(true);
    setError("");
    const token = nonce.current || crypto.randomUUID();
    nonce.current = token;
    try {
      const next = await api<Session>(
        "/sessions/" + session.id + "/send",
        "POST",
        {
          question: text,
          archive: scope,
          template: tpl?.id,
          field_values: fieldValues,
          output_mode: outputMode,
          nonce: token,
          revision: session.revision,
        },
      );
      setSession(next);
      setText("");
      setScope(false);
      if (!keepTpl) {
        setTpl(null);
        setFieldValues({});
        setShowFields(false);
      }
      setOutputMode("auto");
      const first = next.turns.at(-1)?.sources[0];
      if (first) {
        setSource(first);
        setFile(first.doc);
        setTab(next.selected.includes(first.doc) ? "selected" : "all");
      }
      await refresh();
      requestAnimationFrame(() => {
        rail.current?.scrollTo({
          top: rail.current.scrollHeight,
          behavior: "smooth",
        });
        draft.current?.focus();
      });
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }

  function details(t: Turn) {
    setDetail(t);
    setVersion(null);
    setPanel("details");
    void api<Config>("/config/" + t.configVersion)
      .then(setVersion)
      .catch(report);
  }

  function handleRefineDocument(turn: Turn) {
    const targetTpl =
      (turn.template && st.templates.find((x) => x.id === turn.template?.id)) ||
      (turn.document?.templateName &&
        st.templates.find((x) => x.name === turn.document?.templateName)) ||
      null;
    if (targetTpl) {
      setTpl(targetTpl);
      setKeepTpl(true);
    }
    setText((prev) => prev || "Aggiorna la bozza del documento con queste indicazioni: ");
    draft.current?.focus();
  }

  const nav = (
    <>
      <div className="brand-row">
        <Brand />
      </div>
      <button
        type="button"
        className="new-chat"
        disabled={block}
        onClick={() => void newChat()}
      >
        <SquarePen size={16} />
        Nuova conversazione
      </button>
      <nav className="navigation" aria-label="Studio">
        <button type="button" disabled={block} onClick={() => setPanel("practices")}>
          <FolderOpen />
          Pratiche
        </button>
        <button type="button" disabled={block} onClick={() => setPanel("models")}>
          <FileStack />
          Modelli di documenti
        </button>
        <button type="button" disabled={block} onClick={() => setPanel("folders")}>
          <FolderSearch />
          Cartelle retrieval
          {folders.length > 0 && (
            <span className="nav-count">{activeFoldersCount}</span>
          )}
        </button>
      </nav>
      <section className="active-matter">
        <small>Pratica aperta</small>
        <button
          type="button"
          className="matter-name"
          disabled={block}
          onClick={() => setPanel("practices")}
        >
          <span>{matter.name}</span>
          <ChevronsUpDown size={14} />
        </button>
        <div className="session-list">
          {st.sessions
            .filter((i) => i.matter === session.matter)
            .map((i) => (
              <div
                key={i.id}
                className={"session-row " + (i.id === session.id ? "active" : "")}
              >
                <button
                  type="button"
                  disabled={block}
                  className={i.id === session.id ? "active" : ""}
                  onClick={() => void load(i.id).catch(report)}
                >
                  <MessageSquare size={14} />
                  <span>{i.title}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn session-del"
                  aria-label={"Elimina conversazione " + i.title}
                  title="Elimina conversazione"
                  disabled={block}
                  onClick={() => setDeleteSessionTarget(i)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
        </div>
      </section>
      <div className="nav-bottom">
        <button type="button" disabled={block} onClick={() => setPanel("settings")}>
          <Gear size={17} />
          Configurazione
        </button>
        <button
          type="button"
          className="connection connection-btn"
          onClick={() => setPanel("settings")}
          title="Gestisci chiave API Gemini"
        >
          <i className={st.online ? "connected" : ""} />
          {st.online ? "Gemini configurato" : "Modalità locale · Imposta chiave"}
        </button>
      </div>
    </>
  );

  const inspector = (
    <>
      <div className="inspector-heading">
        <h2>Fonti della sessione</h2>
        <div className="inline-actions">
          <IconButton
            label="Cartelle di retrieval"
            disabled={block}
            onClick={() => setPanel("folders")}
          >
            <FolderSearch />
          </IconButton>
          <IconButton
            label="Carica documenti"
            disabled={block}
            onClick={() => setPanel("upload")}
          >
            <FilePlus2 />
          </IconButton>
        </div>
      </div>
      <div className="source-tabs">
        <button
          type="button"
          aria-pressed={tab === "selected"}
          className={tab === "selected" ? "on" : ""}
          onClick={() => setTab("selected")}
        >
          Nel contesto <span>{session.selected.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={tab === "all"}
          className={tab === "all" ? "on" : ""}
          onClick={() => setTab("all")}
        >
          Fascicolo <span>{session.docs.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={tab === "folders"}
          className={tab === "folders" ? "on" : ""}
          onClick={() => setTab("folders")}
        >
          Cartelle <span>{folders.length}</span>
        </button>
      </div>

      {tab === "folders" ? (
        <div className="inspector-folders">
          {folders.map((f) => (
            <div className="mini-folder-card" key={f.id}>
              <div className="mini-folder-top">
                <FolderSearch size={14} />
                <strong>{f.label}</strong>
                <span className={"status-pill " + (f.enabled ? "risk-low" : "risk-mid")}>
                  {f.enabled ? "Attiva" : "Pausa"}
                </span>
              </div>
              <small className="folder-path">{f.path}</small>
              <div className="mini-folder-foot">
                <span>{f.fileCount} file</span>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() =>
                    void api(`/matters/${session.matter}/folders/${f.id}/sync`, "POST")
                      .then(reloadCurrentSession)
                      .catch(report)
                  }
                >
                  <RefreshCw size={11} /> Aggiorna
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="outline full-width"
            onClick={() => setPanel("folders")}
          >
            <FolderPlus size={14} />
            Gestisci cartelle di retrieval
          </button>
        </div>
      ) : (
        <>
          {session.docs.length > 5 && (
            <input
              aria-label="Filtra documenti"
              className="doc-filter-input"
              placeholder="Filtra per nome o cartella…"
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
            />
          )}
          <div className="file-list">
            {docs.map((d) => (
              <div
                className={
                  "file-row " +
                  (file === d.id ? "picked " : "") +
                  (d.folderEnabled === false ? "folder-paused" : "")
                }
                key={d.id}
              >
                <button
                  type="button"
                  onClick={() => chooseDoc(d)}
                  title={"Leggi " + (d.relPath || d.name)}
                >
                  {/xlsx|csv/.test(d.name.toLowerCase()) ? (
                    <FileSpreadsheet />
                  ) : (
                    <FileText />
                  )}
                  <div className="file-name-wrap">
                    <span>{d.name}</span>
                    {d.folderLabel && (
                      <small className="file-folder-tag">{d.folderLabel}</small>
                    )}
                  </div>
                </button>
                {!d.folderId && (
                  <button
                    type="button"
                    className="icon-btn file-del"
                    aria-label={"Elimina documento " + d.name}
                    title="Elimina documento"
                    disabled={block}
                    onClick={() => setDeleteDocTarget(d)}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
                <button
                  type="button"
                  className={
                    "file-check " +
                    (session.selected.includes(d.id) ? "checked" : "")
                  }
                  role="checkbox"
                  aria-checked={session.selected.includes(d.id)}
                  aria-label={
                    (session.selected.includes(d.id)
                      ? "Rimuovi dal contesto "
                      : "Aggiungi al contesto ") + d.name
                  }
                  disabled={block}
                  onClick={() => void toggleDoc(d.id).catch(report)}
                >
                  {session.selected.includes(d.id) ? (
                    <Check size={12} />
                  ) : (
                    <Plus size={12} />
                  )}
                </button>
              </div>
            ))}
            {!docs.length && (
              <p className="muted compact">
                {tab === "all"
                  ? "Il fascicolo è vuoto."
                  : "Nessun documento nel contesto."}{" "}
                <button
                  type="button"
                  className="text-btn"
                  onClick={() =>
                    session.docs.length ? setTab("all") : setPanel("upload")
                  }
                >
                  {session.docs.length ? "Scegli dal fascicolo" : "Carica un file"}
                </button>
              </p>
            )}
          </div>
        </>
      )}

      {doc && (
        <div className="reader-zone">
          <div className="reader-label">
            <span>
              <BookOpen size={14} />
              {doc.name}
            </span>
            {source && <small>Fonte citata</small>}
          </div>
          <Reader key={doc.id} doc={doc} source={source} />
        </div>
      )}
      <div className="inspector-bottom">
        <button
          type="button"
          disabled={!st.settings.tools.includes("search") || block}
          onClick={() => setPanel("search")}
        >
          <Search size={17} />
          Cerca nel fascicolo
          <ChevronRight size={15} />
        </button>
      </div>
    </>
  );

  return (
    <div className="workspace">
      <a className="skip" href="#messaggio">
        Vai al messaggio
      </a>
      <aside className="sidebar">{nav}</aside>
      <main className="chat-pane">
        <header className="chat-header">
          <div className="crumb">
            <button
              type="button"
              className="mobile-nav icon-btn"
              aria-label="Apri navigazione"
              onClick={() => setPanel("nav")}
            >
              <Menu />
            </button>
            <button
              type="button"
              onClick={() => setPanel("practices")}
              disabled={block}
            >
              Pratiche
            </button>
            <ChevronRight size={13} />
            <span>{matter.name}</span>
            <button
              type="button"
              className="mobile-sources"
              onClick={() => setPanel("sources")}
            >
              <PanelRight size={16} />
              Fonti
            </button>
          </div>
          <h1>{session.title}</h1>
        </header>
        <div className="transcript" ref={rail} aria-label="Conversazione">
          {session.turns.map((t) => (
            <Conversation
              key={t.id}
              turn={t}
              onSource={openSource}
              details={() => details(t)}
              onRefineDocument={handleRefineDocument}
            />
          ))}
          {!session.turns.length && (
            <div className="empty-chat">
              <span className="empty-symbol">
                <MessageSquare size={24} />
              </span>
              <h2>Da dove iniziamo?</h2>
              <p>
                {session.selected.length
                  ? "Fai una domanda sui documenti, richiedi una tabella comparativa, un grafico o compila un modello di documento."
                  : "Seleziona i documenti della pratica, collega una cartella o carica un file."}
              </p>
              <div className="starter-chips">
                {session.docs.some((d) => d.name === "Contratto.pdf") && (
                  <>
                    <button
                      type="button"
                      className="outline"
                      onClick={() => {
                        setText(
                          "Qual è il termine di preavviso previsto dal contratto?",
                        );
                        draft.current?.focus();
                      }}
                    >
                      Qual è il termine di preavviso?
                    </button>
                    <button
                      type="button"
                      className="outline"
                      onClick={() => {
                        setScope(true);
                        setOutputMode("table");
                        setText(
                          "Cerca nel fascicolo e crea una tabella comparativa tra Contratto, Addendum e Listino.",
                        );
                        draft.current?.focus();
                      }}
                    >
                      Confronto tabellare del fascicolo
                    </button>
                    <button
                      type="button"
                      className="outline"
                      onClick={() => {
                        setScope(true);
                        setOutputMode("chart");
                        setText(
                          "Cerca nel fascicolo il preavviso e mostra un grafico comparativo dei giorni.",
                        );
                        draft.current?.focus();
                      }}
                    >
                      Grafico comparativo preavviso
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {busy && (
            <div className="working" role="status">
              <span />
              {st.online
                ? "L'orchestratore sta consultando le fonti…"
                : "Ricerca e sintesi locale…"}
            </div>
          )}
        </div>
        <div className="compose-area">
          {error && (
            <div className="error-box" role="alert">
              {error}
              <IconButton label="Chiudi messaggio" onClick={() => setError("")}>
                <X />
              </IconButton>
            </div>
          )}

          {tpl && (
            <div className="active-doc-bar">
              <div className="active-doc-top">
                <span className="active-doc-badge">
                  <FileCheck2 size={14} />
                  Modello: <strong>{tpl.name}</strong>
                  {(tpl.examples?.length || 0) > 0 && (
                    <small>({tpl.examples!.length} esempi)</small>
                  )}
                </span>
                <div className="active-doc-controls">
                  {tplFields.length > 0 && (
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => setShowFields(!showFields)}
                    >
                      <SlidersHorizontal size={12} />
                      Campi ({Object.values(fieldValues).filter(Boolean).length}/
                      {tplFields.length})
                    </button>
                  )}
                  <label className="keep-tpl-check">
                    <input
                      type="checkbox"
                      checked={keepTpl}
                      onChange={(e) => setKeepTpl(e.target.checked)}
                    />
                    Mantieni attivo
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Rimuovi modello attivo"
                    onClick={() => {
                      setTpl(null);
                      setFieldValues({});
                      setShowFields(false);
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              {showFields && tplFields.length > 0 && (
                <div className="quick-fields-grid">
                  {tplFields.map((f) => (
                    <label key={f}>
                      <span>{f}</span>
                      <input
                        placeholder="Compila qui o scrivi in chat…"
                        value={fieldValues[f] || ""}
                        onChange={(e) =>
                          setFieldValues((prev) => ({ ...prev, [f]: e.target.value }))
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {(scope || outputMode !== "auto") && (
            <div className="attached-flags">
              {scope && (
                <button type="button" onClick={() => setScope(false)}>
                  Ricerca nel fascicolo <X size={12} />
                </button>
              )}
              {outputMode !== "auto" && (
                <button type="button" onClick={() => setOutputMode("auto")}>
                  Resa: {OUTPUT_MODES[outputMode]} <X size={12} />
                </button>
              )}
            </div>
          )}

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              id="messaggio"
              ref={draft}
              aria-label="Messaggio"
              placeholder={
                tpl
                  ? `Fornisci indicazioni per compilare "${tpl.name}" (es. Destinatario: ..., Oggetto: ...)…`
                  : "Scrivi nella pratica…"
              }
              value={text}
              disabled={block}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="compose-tools">
              <IconButton
                label="Allega documenti"
                disabled={block}
                onClick={() => setPanel("upload")}
              >
                <Plus />
              </IconButton>
              <IconButton
                label="Scegli modello di documento"
                disabled={block}
                onClick={() => setPanel("models")}
              >
                <FileStack />
              </IconButton>
              <span className="tiny-rule" />
              <Picker
                label="Formato risposta"
                value={outputMode}
                options={OUTPUT_MODES}
                onChange={(v) =>
                  setOutputMode(v as "auto" | "table" | "chart" | "document")
                }
                disabled={block}
              />
              <Picker
                label="Modello Gemini"
                value={session.model}
                options={st.models}
                onChange={(model) => void update({ model }).catch(report)}
                disabled={block}
              />
              <Picker
                label="Livello di pensiero"
                value={session.level}
                options={st.levels}
                onChange={(level) => void update({ level }).catch(report)}
                disabled={block}
              />
              <div className="grow" />
              <IconButton
                label="Modalità vocale · anteprima"
                onClick={() => setPanel("voice")}
              >
                <AudioLines />
              </IconButton>
              <button
                className="send"
                aria-label="Invia messaggio"
                disabled={block || !text.trim() || pct > 100}
              >
                <ArrowUp size={18} />
              </button>
            </div>
          </form>
          <div className="composer-footer">
            <div className="footer-left">
              <button
                type="button"
                className="context-btn"
                title="Dettaglio del contesto"
                onClick={() => setPanel("context")}
              >
                <span
                  className="ring"
                  style={{
                    background:
                      "conic-gradient(var(--blue) " +
                      Math.min(100, pct) +
                      "%, #d9e1f1 0)",
                  }}
                />
                Contesto {meterError ? "indisponibile" : percent}
                {meter?.estimated && <small>stima</small>}
              </button>
              <button
                type="button"
                className="folder-pill-btn"
                onClick={() => setPanel("folders")}
              >
                <FolderSearch size={12} />
                Cartelle: {activeFoldersCount}
              </button>
            </div>
            <button
              type="button"
              className={"archive-toggle " + (scope ? "on" : "")}
              disabled={block || !st.settings.tools.includes("search")}
              aria-pressed={scope}
              onClick={() => setScope(!scope)}
            >
              <Search size={13} />
              {scope ? "Fascicolo incluso" : "Includi fascicolo"}
            </button>
          </div>
        </div>
      </main>
      <aside className="inspector">{inspector}</aside>

      {panel === "nav" && (
        <Modal title="Studio" onClose={() => setPanel(null)}>
          <div className="mobile-navigation">{nav}</div>
        </Modal>
      )}
      {panel === "sources" && (
        <Modal title="Documenti" onClose={() => setPanel(null)}>
          {inspector}
        </Modal>
      )}
      {panel === "settings" && (
        <Settings
          studio={st}
          done={refreshThenVoid}
          close={() => setPanel(null)}
        />
      )}
      {panel === "models" && (
        <DocumentModels
          studio={st}
          refresh={refreshThenVoid}
          close={() => setPanel(null)}
          useTemplate={(t) => {
            setTpl(t);
            setKeepTpl(true);
            setFieldValues({});
            setPanel(null);
            setText(
              `Prepara "${t.name}" usando le fonti della pratica e le seguenti indicazioni: `,
            );
            draft.current?.focus();
          }}
        />
      )}
      {panel === "folders" && (
        <FoldersPanel
          session={session}
          onReload={reloadCurrentSession}
          close={() => setPanel(null)}
        />
      )}
      {panel === "practices" && (
        <Practices
          studio={st}
          currentMatterId={session.matter}
          activate={activate}
          onMatterDeleted={handleMatterDeleted}
          close={() => setPanel(null)}
        />
      )}
      {panel === "upload" && (
        <UploadPanel
          session={session}
          complete={(next) => {
            setSession(next);
            setTab("all");
          }}
          close={() => setPanel(null)}
        />
      )}
      {panel === "search" && (
        <SearchPanel
          session={session}
          studio={st}
          onAttach={(id) =>
            update({ selected: [...new Set([...session.selected, id])] })
          }
          onSource={openSource}
          close={() => setPanel(null)}
        />
      )}
      {panel === "voice" && (
        <Modal title="Conversazione vocale" onClose={() => setPanel(null)}>
          <div className="voice-preview">
            <AudioLines size={38} />
            <h3>Gemini 3.8 Live</h3>
            <small>Anteprima</small>
            <p>
              Potrai parlare con l’assistente e interromperlo durante la
              risposta. Nel POC la conversazione avviene via testo.
            </p>
          </div>
        </Modal>
      )}
      {panel === "context" && (
        <Modal
          title="Contesto del prossimo turno"
          onClose={() => setPanel(null)}
        >
          <h3>
            {meter
              ? percent + " della finestra di input"
              : "Conteggio in corso"}
          </h3>
          <p>
            {meter
              ? fmt(meter.used) +
                " token su " +
                fmt(meter.limit) +
                " · " +
                (meter.estimated ? "stima locale" : "conteggio Gemini")
              : meterError || "Preparazione della richiesta…"}
          </p>
          <p className="muted">
            Il conteggio include istruzioni, cronologia, documenti selezionati,
            esempi del modello attivo e passaggi recuperati. Per liberare spazio
            puoi rimuovere un allegato e cercarne i passaggi nel fascicolo.
          </p>
        </Modal>
      )}
      {panel === "details" && detail && (
        <Modal title="Dettagli della risposta" wide onClose={() => setPanel(null)}>
          <dl>
            <dt>Origine</dt>
            <dd>
              {detail.mode === "example"
                ? "Conversazione sintetica precompilata"
                : detail.mode === "local"
                  ? "Ricerca estrattiva locale"
                  : st.models[detail.model || ""] +
                    " · " +
                    st.levels[detail.level]}
            </dd>
            <dt>Strumenti utilizzati</dt>
            <dd>{detail.trace.join(" · ") || "Nessun richiamo a strumenti"}</dd>
            {detail.skills && detail.skills.length > 0 && (
              <>
                <dt>Skills attivate</dt>
                <dd>{detail.skills.join(" · ")}</dd>
              </>
            )}
            {detail.plan && detail.plan.length > 0 && (
              <>
                <dt>Piano agentico multi-retrieval</dt>
                <dd>
                  <ul className="plan-detail-list">
                    {detail.plan.map((p, idx) => (
                      <li key={idx}>
                        <strong>{p.strategy}</strong>
                        {p.docFilter ? ` [${p.docFilter}]` : ""}: &laquo;{p.query}&raquo;
                        {" → "}
                        {p.hits} risultati ({p.reason})
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            <dt>Fonti citate</dt>
            <dd>{detail.sources.length}</dd>
            {detail.meter && (
              <>
                <dt>Token di input</dt>
                <dd>
                  {fmt(detail.meter.used)}
                  {detail.meter.estimated ? " (stima)" : ""}
                </dd>
              </>
            )}
            {detail.template && (
              <>
                <dt>Modello di documento</dt>
                <dd>
                  {detail.template.name} · v{detail.template.version}
                </dd>
              </>
            )}
            <dt>Prompt di sistema · v{detail.configVersion}</dt>
            <dd>{version?.prompt || "Caricamento…"}</dd>
          </dl>
        </Modal>
      )}

      {deleteSessionTarget && (
        <ConfirmModal
          title="Elimina conversazione"
          message={`Vuoi eliminare definitivamente la conversazione "${deleteSessionTarget.title}"?`}
          confirmLabel="Elimina conversazione"
          busy={editing}
          onConfirm={() => void confirmDeleteSession()}
          onCancel={() => setDeleteSessionTarget(null)}
        />
      )}
      {deleteDocTarget && (
        <ConfirmModal
          title="Elimina documento"
          message={`Vuoi rimuovere "${deleteDocTarget.name}" dalla pratica e dal relativo indice di ricerca?`}
          confirmLabel="Elimina documento"
          busy={editing}
          onConfirm={() => void confirmDeleteDoc()}
          onCancel={() => setDeleteDocTarget(null)}
        />
      )}
    </div>
  );

  async function refreshThenVoid() {
    await refresh();
  }
}

createRoot(document.getElementById("root")!).render(<App />);
