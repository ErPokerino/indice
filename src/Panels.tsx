import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  KeyRound,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  api,
  err,
  type Config,
  type Folder as FolderItem,
  type Session,
  type Source,
  type Studio,
  type Template,
} from "./types";
import { ConfirmModal, Modal, Picker } from "./ui";

const previews = [
  [
    "Tabular Review Multi-Documento",
    "Griglia comparativa stile Legora su decine di contratti con citazione verificata per singola cella.",
  ],
  [
    "Word Add-in & Redlining Playbook",
    "Revisione diretta in Microsoft Word rispetto ai playbook e posizioni di fallback dello studio.",
  ],
  [
    "PostgreSQL / DMS (iManage, SharePoint)",
    "Interrogazione in sola lettura di basi dati e sincronizzazione bidirezionale con i DMS legali.",
  ],
  [
    "Document AI (OCR)",
    "OCR ad alta precisione dei PDF scansionati con mantenimento delle coordinate per l'evidenziazione.",
  ],
  [
    "Ricerca web & Banche dati normative",
    "Verifica esterna con indirizzo, data della fonte, Normattiva e giurisprudenza aggiornata.",
  ],
  [
    "GraphRAG",
    "Mappatura delle relazioni tra società, persone, atti modificativi, clausole e scadenze.",
  ],
  [
    "Gemini 3.8 Live",
    "Conversazione vocale bidirezionale con l’assistente e gestione delle interruzioni.",
  ],
];

const CATEGORIES = [
  "Corrispondenza",
  "Contrattualistica",
  "Contenzioso",
  "Pareri",
  "Compliance",
  "Generale",
];

function categorySlug(cat: string) {
  const c = (cat || "Generale").toLowerCase();
  if (c.includes("corrisp")) return "cat-blue";
  if (c.includes("contratt")) return "cat-emerald";
  if (c.includes("contenz")) return "cat-crimson";
  if (c.includes("parer")) return "cat-indigo";
  if (c.includes("compl")) return "cat-amber";
  return "cat-slate";
}

export function Settings({
  studio,
  done,
  close,
}: {
  studio: Studio;
  done: () => Promise<void>;
  close: () => void;
}) {
  const [v, set] = useState<Config>(studio.settings),
    [tab, setTab] = useState("Assistente"),
    [error, setError] = useState(""),
    [info, setInfo] = useState(""),
    [busy, setBusy] = useState(false);

  const [apiKeyInput, setApiKeyInput] = useState(""),
    [showKey, setShowKey] = useState(false),
    [keyBusy, setKeyBusy] = useState(false);

  const patch = (x: Partial<Config>) => set((p) => ({ ...p, ...x }));

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/config", "PUT", v);
      await done();
      close();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveKey(valueToSave: string) {
    setKeyBusy(true);
    setError("");
    setInfo("");
    try {
      await api("/config/api-key", "PUT", { apiKey: valueToSave });
      setApiKeyInput("");
      await done();
      setInfo(
        valueToSave.trim()
          ? "Chiave API salvata nella configurazione locale dell'app."
          : "Chiave API salvata in app rimossa.",
      );
    } catch (e) {
      setError(err(e));
    } finally {
      setKeyBusy(false);
    }
  }

  async function testKey() {
    setKeyBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await api<{ ok: boolean; detail: string }>(
        "/config/api-key/test",
        "POST",
        { apiKey: apiKeyInput },
      );
      setInfo(r.detail);
    } catch (e) {
      setError(err(e));
    } finally {
      setKeyBusy(false);
    }
  }

  const sourceLabel =
    studio.apiKey?.source === "app"
      ? "Salvata in app"
      : studio.apiKey?.source === "env"
        ? "Variabile d'ambiente"
        : studio.apiKey?.source === "dotenv"
          ? "File .env"
          : "Non configurata (modalità locale)";

  return (
    <Modal title="Configurazione" wide onClose={close}>
      <div className="tabs">
        {["Assistente", "Strumenti", "Orchestratore", "Integrazioni"].map((t) => (
          <button
            type="button"
            key={t}
            className={tab === t ? "on" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Assistente" && (
        <>
          <div className="hero-key-box">
            <div className="key-head">
              <strong>
                <KeyRound size={16} />
                Chiave API Gemini
              </strong>
              <span className={"status-dot " + (studio.online ? "on" : "")}>
                {sourceLabel}
                {studio.apiKey?.masked ? ` · ${studio.apiKey.masked}` : ""}
              </span>
            </div>
            <p>
              Inserisci e salva la chiave direttamente qui (conservata nel database
              locale dell&apos;app, mai esposta al browser in chiaro). In assenza di
              chiave l&apos;app opera in modalità estrattiva locale.
            </p>
            <div className="key-row">
              <div className="key-input-wrap">
                <input
                  type={showKey ? "text" : "password"}
                  aria-label="Chiave API Gemini"
                  placeholder="Incolla chiave API Gemini (es. AIza...)"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={showKey ? "Nascondi chiave" : "Mostra chiave"}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <button
                type="button"
                className="primary"
                disabled={keyBusy || !apiKeyInput.trim()}
                onClick={() => void saveKey(apiKeyInput)}
              >
                Salva chiave
              </button>
              <button
                type="button"
                className="outline"
                disabled={keyBusy || (!apiKeyInput.trim() && !studio.online)}
                onClick={() => void testKey()}
              >
                Testa connessione
              </button>
              {studio.apiKey?.source === "app" && (
                <button
                  type="button"
                  className="outline danger-outline"
                  disabled={keyBusy}
                  onClick={() => void saveKey("")}
                >
                  Rimuovi chiave
                </button>
              )}
            </div>
            {info && <p className="info-msg">{info}</p>}
          </div>

          <label>
            Prompt di sistema <span className="quiet">v{v.version}</span>
            <textarea
              rows={5}
              value={v.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
            />
          </label>
          <div className="pair">
            <div>
              <span className="field-label">Modello per nuove chat</span>
              <Picker
                label="Modello predefinito"
                options={studio.models}
                value={v.model}
                onChange={(model) => patch({ model })}
              />
            </div>
            <div>
              <span className="field-label">Livello di pensiero</span>
              <Picker
                label="Livello predefinito"
                options={studio.levels}
                value={v.level}
                onChange={(level) => patch({ level })}
              />
            </div>
          </div>
        </>
      )}
      {tab === "Strumenti" && (
        <>
          <p className="muted">
            Strumenti disponibili all’assistente e all&apos;orchestratore per i
            prossimi messaggi.
          </p>
          {Object.entries(studio.tools).map(([k, l]) => (
            <label className="check-row" key={k}>
              <span>{l}</span>
              <input
                type="checkbox"
                className="switch"
                checked={v.tools.includes(k)}
                onChange={(e) =>
                  patch({
                    tools: e.target.checked
                      ? [...v.tools, k]
                      : v.tools.filter((t) => t !== k),
                  })
                }
              />
            </label>
          ))}
          <label className="check-row">
            <span>Ricerca semantica</span>
            <input
              type="checkbox"
              className="switch"
              checked={v.semantic}
              onChange={(e) => patch({ semantic: e.target.checked })}
            />
          </label>
          <p className="muted">
            Con una chiave attiva, la ricerca semantica invia i passaggi della
            pratica a Gemini Embedding per l’indicizzazione. I vettori sono
            salvati sul computer.
          </p>
        </>
      )}
      {tab === "Orchestratore" && (
        <div className="blueprint-grid">
          <p className="muted">
            L&apos;orchestratore analizza ogni richiesta, la scompone in più
            sotto-ricerche parallele (es. clausola esatta + riassunto documento +
            celle Excel + concetto semantico) e attiva le skill legali pertinenti.
          </p>
          <h3>Tools di retrieval ed esecuzione</h3>
          <div className="blueprint-list two-col">
            {studio.agentBlueprint?.tools.map((tool) => (
              <div className="blueprint-card" key={tool.id}>
                <div className="blueprint-top">
                  <strong>{tool.name}</strong>
                  <small>{tool.category}</small>
                </div>
                <p>{tool.desc}</p>
              </div>
            ))}
          </div>
          <h3>Skills modulari attive</h3>
          <div className="blueprint-list two-col">
            {studio.agentBlueprint?.skills.map((skill) => (
              <div className="blueprint-card" key={skill.id}>
                <div className="blueprint-top">
                  <strong>
                    <Sparkles size={13} /> {skill.name}
                  </strong>
                  <small>{skill.trigger}</small>
                </div>
                <p>{skill.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "Integrazioni" && (
        <div className="integration-grid">
          {previews.map(([name, desc]) => (
            <section className="blueprint-card" key={name}>
              <div className="blueprint-top">
                <strong>{name}</strong>
                <small>Anteprima</small>
              </div>
              <p>{desc}</p>
            </section>
          ))}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {(tab === "Assistente" || tab === "Strumenti") && (
        <footer className="actions">
          <button
            type="button"
            className="primary"
            disabled={busy || !v.prompt.trim()}
            onClick={() => void save()}
          >
            Salva configurazione
          </button>
        </footer>
      )}
    </Modal>
  );
}

const emptyTemplate: Template = {
  id: 0,
  version: 0,
  name: "",
  purpose: "",
  sections: "",
  fields: "",
  instructions: "",
  category: "Generale",
  tone: "Professionale chiaro",
  audience: "Cliente",
  jurisdiction: "Diritto italiano",
  output_format: "Documento strutturato",
  clause_rules: "",
  custom_attrs: [],
  examples: [],
};

export function DocumentModels({
  studio,
  useTemplate,
  refresh,
  close,
}: {
  studio: Studio;
  useTemplate: (t: Template) => void;
  refresh: () => Promise<void>;
  close: () => void;
}) {
  const [editing, set] = useState<Template | null>(null),
    [categoryFilter, setCategoryFilter] = useState("Tutti"),
    [searchQ, setSearchQ] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState<Template | null>(null),
    [exTitle, setExTitle] = useState(""),
    [exText, setExText] = useState(""),
    [exNotes, setExNotes] = useState(""),
    [exFileNotes, setExFileNotes] = useState(""),
    [exMode, setExMode] = useState<"none" | "file" | "text">("none");

  const visibleTemplates = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return studio.templates.filter((t) => {
      if (categoryFilter !== "Tutti" && (t.category || "Generale") !== categoryFilter)
        return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.purpose.toLowerCase().includes(q) ||
        (t.category || "").toLowerCase().includes(q)
      );
    });
  }, [studio.templates, categoryFilter, searchQ]);

  async function persistEditing(): Promise<Template | null> {
    if (!editing) return null;
    const payload = {
      ...editing,
      custom_attrs: (editing.custom_attrs || []).filter((a) => a.key.trim()),
    };
    const saved = await api<Template>(
      editing.id ? "/templates/" + editing.id : "/templates",
      editing.id ? "PUT" : "POST",
      payload,
    );
    await refresh();
    return saved;
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await persistEditing();
      set(null);
      setExMode("none");
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function ensureSavedId(): Promise<number | null> {
    if (!editing) return null;
    if (editing.id) return editing.id;
    if (!editing.name.trim()) {
      setError("Inserisci prima il nome del modello.");
      return null;
    }
    const saved = await persistEditing();
    if (saved) set(saved);
    return saved?.id || null;
  }

  async function attachExampleFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const tid = await ensureSavedId();
      if (!tid) return;
      const fd = new FormData();
      fd.set("file", file);
      fd.set("notes", exFileNotes);
      const updated = await api<Template>(
        `/templates/${tid}/examples/file`,
        "POST",
        fd,
      );
      set(updated);
      setExFileNotes("");
      setExMode("none");
      await refresh();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function attachExampleText() {
    if (!exTitle.trim() || !exText.trim()) return;
    setBusy(true);
    setError("");
    try {
      const tid = await ensureSavedId();
      if (!tid) return;
      const updated = await api<Template>(`/templates/${tid}/examples/text`, "POST", {
        name: exTitle,
        text: exText,
        notes: exNotes,
      });
      set(updated);
      setExTitle("");
      setExText("");
      setExNotes("");
      setExMode("none");
      await refresh();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeExample(eid: number) {
    if (!editing?.id) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Template>(
        `/templates/${editing.id}/examples/${eid}`,
        "DELETE",
      );
      set(updated);
      await refresh();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeTemplate(t: Template) {
    setBusy(true);
    setError("");
    try {
      await api(`/templates/${t.id}`, "DELETE");
      await refresh();
      setConfirmDelete(null);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={
          editing
            ? editing.id
              ? "Modifica modello di documento"
              : "Nuovo modello di documento"
            : "Modelli di documenti"
        }
        wide
        onClose={close}
      >
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="pair">
              <label>
                Nome
                <input
                  required
                  value={editing.name}
                  onChange={(e) => set({ ...editing, name: e.target.value })}
                />
              </label>
              <label>
                Categoria
                <input
                  list="legal-doc-categories"
                  value={editing.category || ""}
                  onChange={(e) => set({ ...editing, category: e.target.value })}
                />
                <datalist id="legal-doc-categories">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
            </div>

            <label>
              Finalità
              <textarea
                rows={2}
                value={editing.purpose}
                onChange={(e) => set({ ...editing, purpose: e.target.value })}
              />
            </label>

            <div className="pair">
              <label>
                Tono e registro
                <input
                  value={editing.tone || ""}
                  onChange={(e) => set({ ...editing, tone: e.target.value })}
                />
              </label>
              <label>
                Destinatario tipico
                <input
                  value={editing.audience || ""}
                  onChange={(e) => set({ ...editing, audience: e.target.value })}
                />
              </label>
            </div>

            <div className="pair">
              <label>
                Giurisdizione / Riferimento normativo
                <input
                  value={editing.jurisdiction || ""}
                  onChange={(e) => set({ ...editing, jurisdiction: e.target.value })}
                />
              </label>
              <label>
                Formato di resa
                <input
                  value={editing.output_format || ""}
                  onChange={(e) => set({ ...editing, output_format: e.target.value })}
                />
              </label>
            </div>

            <label>
              Sezioni, una per riga
              <textarea
                rows={3}
                value={editing.sections}
                onChange={(e) => set({ ...editing, sections: e.target.value })}
              />
            </label>
            <label>
              Campi richiesti, uno per riga
              <textarea
                rows={3}
                value={editing.fields}
                onChange={(e) => set({ ...editing, fields: e.target.value })}
              />
            </label>
            <label>
              Regole clausole e checklist, una per riga
              <textarea
                rows={2}
                value={editing.clause_rules || ""}
                onChange={(e) => set({ ...editing, clause_rules: e.target.value })}
              />
            </label>
            <label>
              Istruzioni di redazione
              <textarea
                rows={3}
                value={editing.instructions}
                onChange={(e) => set({ ...editing, instructions: e.target.value })}
              />
            </label>

            <div className="model-subsection">
              <div className="subsection-head">
                <span className="field-label">Caratteristiche personalizzate</span>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() =>
                    set({
                      ...editing,
                      custom_attrs: [
                        ...(editing.custom_attrs || []),
                        { key: "", value: "" },
                      ],
                    })
                  }
                >
                  <Plus size={13} />
                  Aggiungi caratteristica
                </button>
              </div>
              {(editing.custom_attrs || []).map((attr, idx) => (
                <div className="attr-row" key={idx}>
                  <input
                    aria-label="Nome caratteristica"
                    placeholder="Es. Lunghezza massima"
                    value={attr.key}
                    onChange={(e) => {
                      const next = [...(editing.custom_attrs || [])];
                      next[idx] = { ...next[idx], key: e.target.value };
                      set({ ...editing, custom_attrs: next });
                    }}
                  />
                  <input
                    aria-label="Valore caratteristica"
                    placeholder="Es. 2 pagine con tabella finale"
                    value={attr.value}
                    onChange={(e) => {
                      const next = [...(editing.custom_attrs || [])];
                      next[idx] = { ...next[idx], value: e.target.value };
                      set({ ...editing, custom_attrs: next });
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Rimuovi caratteristica"
                    onClick={() => {
                      const next = (editing.custom_attrs || []).filter(
                        (_, i) => i !== idx,
                      );
                      set({ ...editing, custom_attrs: next });
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="model-subsection">
              <div className="subsection-head">
                <span className="field-label">
                  Esempi di riferimento allegati ({editing.examples?.length || 0})
                </span>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => setExMode(exMode === "file" ? "none" : "file")}
                  >
                    <Upload size={13} />
                    Allega file
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => setExMode(exMode === "text" ? "none" : "text")}
                  >
                    <Paperclip size={13} />
                    Incolla testo
                  </button>
                </div>
              </div>
              <p className="muted">
                Il modello trae spunto da questi esempi per struttura, stile e
                formule legali, compilando però i dati reali dalla pratica e dalla
                chat.
              </p>

              {(editing.examples || []).map((ex) => (
                <div className="example-item" key={ex.id}>
                  <div>
                    <strong>{ex.name}</strong>
                    {ex.notes && <small>{ex.notes}</small>}
                    <p>{ex.preview}{ex.length > 280 ? "…" : ""}</p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={"Rimuovi esempio " + ex.name}
                    disabled={busy}
                    onClick={() => void removeExample(ex.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              {exMode === "file" && (
                <div className="subtle-box example-box">
                  <label>
                    Nota su cosa trarre spunto (opzionale)
                    <input
                      placeholder="Es. Usa l'intestazione formale e la clausola risolutiva"
                      value={exFileNotes}
                      onChange={(e) => setExFileNotes(e.target.value)}
                    />
                  </label>
                  <label className="file-drop compact-drop">
                    <Upload size={18} />
                    <span>Seleziona PDF, DOCX, TXT, MD o XLSX di esempio</span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt,.md,.csv,.xlsx"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void attachExampleFile(f);
                      }}
                    />
                  </label>
                </div>
              )}

              {exMode === "text" && (
                <div className="subtle-box example-box">
                  <label>
                    Titolo esempio
                    <input
                      placeholder="Es. Diffida tipo studio 2025"
                      value={exTitle}
                      onChange={(e) => setExTitle(e.target.value)}
                    />
                  </label>
                  <label>
                    Nota di utilizzo
                    <input
                      placeholder="Es. Imita il registro e la sequenza delle sezioni"
                      value={exNotes}
                      onChange={(e) => setExNotes(e.target.value)}
                    />
                  </label>
                  <label>
                    Testo di esempio
                    <textarea
                      rows={4}
                      placeholder="Incolla qui un estratto o modello di riferimento…"
                      value={exText}
                      onChange={(e) => setExText(e.target.value)}
                    />
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      className="outline"
                      disabled={busy || !exTitle.trim() || !exText.trim()}
                      onClick={() => void attachExampleText()}
                    >
                      Salva esempio
                    </button>
                  </div>
                </div>
              )}
            </div>

            <footer className="actions">
              <button
                type="button"
                className="outline"
                onClick={() => {
                  set(null);
                  setExMode("none");
                }}
              >
                Indietro
              </button>
              <button className="primary" disabled={busy || !editing.name.trim()}>
                Salva modello
              </button>
            </footer>
          </form>
        ) : (
          <>
            <p className="muted">
              Scegli uno standard del settore legale o crea un modello
              personalizzato. In chat verrà compilato automaticamente con le fonti
              della pratica e le tue indicazioni.
            </p>
            <div className="models-toolbar">
              <button
                type="button"
                className="outline"
                onClick={() => set({ ...emptyTemplate })}
              >
                <Plus size={16} />
                Nuovo modello
              </button>
              <input
                aria-label="Filtra modelli"
                className="model-search"
                placeholder="Cerca modello…"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>
            <div className="category-pills">
              {["Tutti", ...CATEGORIES].map((cat) => (
                <button
                  type="button"
                  key={cat}
                  className={categoryFilter === cat ? "on" : ""}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="template-grid">
              {visibleTemplates.map((t) => (
                <section
                  className={"template-card " + categorySlug(t.category)}
                  key={t.id}
                >
                  <div className="list-heading">
                    <FileCheck2 size={17} />
                    <strong>{t.name}</strong>
                    <span className="cat-badge">{t.category || "Generale"}</span>
                    <small>v{t.version}</small>
                  </div>
                  <p>{t.purpose}</p>
                  <div className="model-meta-row">
                    {t.tone && <span>{t.tone}</span>}
                    {t.audience && <span>{t.audience}</span>}
                    {(t.examples?.length || 0) > 0 && (
                      <span className="ex-count-tag">
                        {t.examples!.length}{" "}
                        {t.examples!.length === 1
                          ? "esempio allegato"
                          : "esempi allegati"}
                      </span>
                    )}
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={"Elimina modello " + t.name}
                      onClick={() => setConfirmDelete(t)}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="outline"
                      onClick={() => {
                        set({ ...t });
                        setExMode("none");
                      }}
                    >
                      Modifica e esempi
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => useTemplate(t)}
                    >
                      Usa in chat <ArrowUpRight size={15} />
                    </button>
                  </div>
                </section>
              ))}
            </div>
            {!visibleTemplates.length && (
              <p className="muted">Nessun modello corrisponde al filtro.</p>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </Modal>
      {confirmDelete && (
        <ConfirmModal
          title="Elimina modello di documento"
          message={`Vuoi eliminare il modello "${confirmDelete.name}" e i suoi eventuali esempi allegati?`}
          busy={busy}
          onConfirm={() => void removeTemplate(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}

type BrowseResult = {
  current: string;
  parent: string;
  shortcuts: { label: string; path: string }[];
  entries: { name: string; path: string; files: number }[];
  supportedFilesCount: number;
};

export function FoldersPanel({
  session,
  onReload,
  close,
}: {
  session: Session;
  onReload: () => Promise<void>;
  close: () => void;
}) {
  const [folders, setFolders] = useState<FolderItem[]>(session.folders || []),
    [path, setPath] = useState(""),
    [label, setLabel] = useState(""),
    [recursive, setRecursive] = useState(true),
    [browsing, setBrowsing] = useState(false),
    [browseData, setBrowseData] = useState<BrowseResult | null>(null),
    [busy, setBusy] = useState(false),
    [statusMsg, setStatusMsg] = useState(""),
    [error, setError] = useState("");

  useEffect(() => {
    setFolders(session.folders || []);
  }, [session.folders]);

  async function loadBrowse(targetPath = "") {
    setBusy(true);
    setError("");
    try {
      const r = await api<BrowseResult>(
        "/fs/browse?path=" + encodeURIComponent(targetPath),
      );
      setBrowseData(r);
      setBrowsing(true);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function addFolder() {
    if (!path.trim()) return;
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      const r = await api<{
        folder: FolderItem;
        sync: { added: number; updated: number; removed: number; fileCount: number };
      }>(`/matters/${session.matter}/folders`, "POST", {
        path: path.trim(),
        label: label.trim(),
        recursive,
        enabled: true,
      });
      setPath("");
      setLabel("");
      setBrowsing(false);
      setStatusMsg(
        `Cartella "${r.folder.label}" collegata: ${r.sync.fileCount} file indicizzati.`,
      );
      await onReload();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(f: FolderItem) {
    setBusy(true);
    setError("");
    try {
      await api(`/matters/${session.matter}/folders/${f.id}`, "PUT", {
        enabled: !f.enabled,
      });
      await onReload();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow(f: FolderItem) {
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      const r = await api<{
        folder: FolderItem;
        sync: { added: number; updated: number; removed: number; fileCount: number };
      }>(`/matters/${session.matter}/folders/${f.id}/sync`, "POST");
      setStatusMsg(
        `${r.folder.label}: +${r.sync.added} nuovi, ${r.sync.updated} aggiornati, ${r.sync.removed} rimossi.`,
      );
      await onReload();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeFolder(f: FolderItem) {
    setBusy(true);
    setError("");
    setStatusMsg("");
    try {
      await api(`/matters/${session.matter}/folders/${f.id}`, "DELETE");
      setStatusMsg(`Cartella "${f.label}" scollegata dalla pratica.`);
      await onReload();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function importBrowserFolder(fileList: FileList | null) {
    if (!fileList?.length) return;
    setBusy(true);
    setError("");
    setStatusMsg("");
    let ok = 0;
    try {
      for (const f of Array.from(fileList)) {
        if (!/\.(pdf|docx|xlsx|txt|md|csv|png|jpe?g)$/i.test(f.name)) continue;
        const fd = new FormData();
        fd.set("file", f);
        fd.set("attach", "false");
        await api(`/sessions/${session.id}/upload`, "POST", fd);
        ok++;
      }
      setStatusMsg(`Importati ${ok} file dalla cartella selezionata nel fascicolo.`);
      await onReload();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Cartelle di retrieval" wide onClose={close}>
      <p className="muted">
        Collega una o più cartelle locali contenenti contratti, allegati o atti.
        Tutti i file supportati vengono indicizzati e aggiornati per la ricerca
        ibrida e puntuale di questa pratica.
      </p>

      <div className="folder-list">
        {folders.map((f) => (
          <section className="folder-card" key={f.id}>
            <div className="folder-card-top">
              <div className="folder-title">
                <FolderSearch size={17} />
                <div>
                  <strong>{f.label}</strong>
                  <small className="folder-path mono-path">{f.path}</small>
                </div>
              </div>
              <span
                className={
                  "status-pill " +
                  (!f.exists ? "risk-high" : f.enabled ? "risk-low" : "risk-mid")
                }
              >
                {!f.exists ? "Non trovata" : f.enabled ? "Attiva" : "In pausa"}
              </span>
            </div>
            <div className="folder-meta">
              <span>{f.fileCount} file indicizzati</span>
              <span>{f.recursive ? "Incluse sottocartelle" : "Solo primo livello"}</span>
              {f.lastSync && (
                <span>
                  Sync: {new Date(f.lastSync).toLocaleString("it-IT")}
                </span>
              )}
            </div>
            <div className="folder-actions">
              <label className="inline-check">
                <input
                  type="checkbox"
                  className="switch"
                  checked={f.enabled}
                  disabled={busy}
                  onChange={() => void toggleEnabled(f)}
                />
                Attiva per retrieval
              </label>
              <div className="inline-actions">
                <button
                  type="button"
                  className="mini-btn"
                  disabled={busy}
                  onClick={() => void syncNow(f)}
                >
                  <RefreshCw size={13} />
                  Sincronizza
                </button>
                <button
                  type="button"
                  className="mini-btn danger-outline"
                  disabled={busy}
                  onClick={() => void removeFolder(f)}
                >
                  <Trash2 size={13} />
                  Scollega
                </button>
              </div>
            </div>
          </section>
        ))}
        {!folders.length && (
          <div className="subtle-box">
            <strong>Nessuna cartella collegata a questa pratica</strong>
            <p>
              Inserisci il percorso di una cartella o sfoglia il computer qui sotto
              per iniziare il retrieval automatico sui file.
            </p>
          </div>
        )}
      </div>

      {statusMsg && <p className="info-msg">{statusMsg}</p>}
      {error && <p role="alert">{error}</p>}

      <form
        className="create-form folder-form"
        onSubmit={(e) => {
          e.preventDefault();
          void addFolder();
        }}
      >
        <h3>Collega nuova cartella locale</h3>
        <div className="folder-path-row">
          <input
            aria-label="Percorso cartella"
            placeholder="Es. C:\Users\Nome\Documenti\Pratica_Orione"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
          />
          <button
            type="button"
            className="outline"
            disabled={busy}
            onClick={() => void loadBrowse(path)}
          >
            <FolderOpen size={15} />
            Sfoglia computer
          </button>
        </div>

        {browsing && browseData && (
          <div className="browser-box">
            <div className="browser-head">
              <strong>{browseData.current || "Risorse del computer"}</strong>
              <div className="inline-actions">
                {browseData.parent && (
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => void loadBrowse(browseData.parent)}
                  >
                    Su
                  </button>
                )}
                {browseData.current && (
                  <button
                    type="button"
                    className="mini-btn primary-mini"
                    onClick={() => {
                      setPath(browseData.current);
                      setBrowsing(false);
                    }}
                  >
                    <Check size={13} />
                    Seleziona questa cartella ({browseData.supportedFilesCount} file)
                  </button>
                )}
              </div>
            </div>
            <div className="browser-shortcuts">
              {browseData.shortcuts.map((sc) => (
                <button
                  type="button"
                  key={sc.path}
                  className="mini-btn"
                  onClick={() => void loadBrowse(sc.path)}
                >
                  {sc.label}
                </button>
              ))}
            </div>
            <div className="browser-entries">
              {browseData.entries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  className="browser-entry"
                  onClick={() => void loadBrowse(entry.path)}
                >
                  <Folder size={14} />
                  <span>{entry.name}</span>
                  {entry.files > 0 && <small>{entry.files} file</small>}
                </button>
              ))}
              {!browseData.entries.length && (
                <p className="muted compact">Nessuna sottocartella.</p>
              )}
            </div>
          </div>
        )}

        <div className="pair">
          <label>
            Nome descrittivo (opzionale)
            <input
              placeholder="Es. Contratti 2025"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="check-row folder-rec">
            <span>Includi sottocartelle</span>
            <input
              type="checkbox"
              className="switch"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
            />
          </label>
        </div>

        <footer className="actions">
          <label className="outline import-dir-btn">
            <Upload size={14} />
            Importa da finestra browser
            <input
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is supported in Chromium/Chrome
              webkitdirectory=""
              style={{ display: "none" }}
              onChange={(e) => void importBrowserFolder(e.target.files)}
            />
          </label>
          <button className="primary" disabled={busy || !path.trim()}>
            <FolderPlus size={15} />
            Collega e indicizza cartella
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function Practices({
  studio,
  currentMatterId,
  activate,
  onMatterDeleted,
  close,
}: {
  studio: Studio;
  currentMatterId?: number;
  activate: (sid: number) => Promise<void>;
  onMatterDeleted: (nextSessionId: number | null) => Promise<void>;
  close: () => void;
}) {
  const [name, set] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState<{
      id: number;
      name: string;
    } | null>(null);

  async function open(m: number) {
    const existing = studio.sessions.find((s) => s.matter === m);
    if (existing) await activate(existing.id);
  }

  async function add() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ session: number }>("/matters", "POST", { name });
      await activate(r.session);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeMatter(mId: number) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ deleted: number; nextSession: number | null }>(
        `/matters/${mId}`,
        "DELETE",
      );
      setConfirmDelete(null);
      await onMatterDeleted(r.nextSession);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title="Pratiche" onClose={close}>
        <div className="practice-list">
          {studio.matters.map((m) => (
            <div
              className={
                "practice-row " + (m.id === currentMatterId ? "active" : "")
              }
              key={m.id}
            >
              <button
                type="button"
                className="list-button"
                onClick={() => void open(m.id).catch((e) => setError(err(e)))}
              >
                <Folder size={17} />
                <div className="practice-info">
                  <span>{m.name}</span>
                  {typeof m.docCount === "number" && (
                    <small>
                      {m.docCount} doc · {m.sessionCount || 0} chat ·{" "}
                      {m.folderCount || 0} cartelle
                    </small>
                  )}
                </div>
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                className="icon-btn delete-row-btn"
                aria-label={"Elimina pratica " + m.name}
                title="Elimina pratica"
                disabled={busy}
                onClick={() => setConfirmDelete(m)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!studio.matters.length && (
            <p className="muted">Nessuna pratica presente. Creane una qui sotto.</p>
          )}
        </div>
        <form
          className="create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label>
            Nuova pratica
            <input
              placeholder="Nome della pratica"
              maxLength={160}
              required
              value={name}
              onChange={(e) => set(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy || !name.trim()}>
            <FolderPlus size={15} />
            Crea pratica
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
      </Modal>
      {confirmDelete && (
        <ConfirmModal
          title="Elimina pratica"
          message={`Vuoi eliminare definitivamente la pratica "${confirmDelete.name}", tutte le sue conversazioni, i documenti indicizzati e i collegamenti alle cartelle?`}
          confirmLabel="Elimina pratica"
          busy={busy}
          onConfirm={() => void removeMatter(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}

export function UploadPanel({
  session,
  complete,
  close,
}: {
  session: Session;
  complete: (s: Session) => void;
  close: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [attach, setAttach] = useState(true),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function run() {
    setPending(true);
    setError("");
    let i = 0;
    try {
      for (const file of files) {
        const data = new FormData();
        data.set("file", file);
        data.set("attach", String(attach));
        const r = await api<{ session: Session }>(
          "/sessions/" + session.id + "/upload",
          "POST",
          data,
        );
        complete(r.session);
        i++;
      }
      close();
    } catch (e) {
      setError(err(e));
      setFiles(files.slice(i));
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title="Carica documenti"
      onClose={() => {
        if (!pending) close();
      }}
    >
      <label
        className="file-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!pending) setFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <Upload />
        <strong>Scegli o trascina i file</strong>
        <span>
          PDF, Word, Excel, CSV, Markdown, testo, JPG e PNG · 32 MB per file
        </span>
        <input
          type="file"
          multiple
          disabled={pending}
          accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg"
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
      </label>
      {files.map((f, i) => (
        <div className="upload-name" key={i}>
          <FileText size={15} />
          {f.name}
        </div>
      ))}
      <label className="radio-row">
        <input type="radio" checked={attach} onChange={() => setAttach(true)} />
        Aggiungi al contesto della chat
      </label>
      <label className="radio-row">
        <input
          type="radio"
          checked={!attach}
          onChange={() => setAttach(false)}
        />
        Archivia nella pratica
      </label>
      {error && <p role="alert">{error}</p>}
      <footer className="actions">
        <button
          className="primary"
          onClick={() => void run()}
          disabled={pending || !files.length}
        >
          {pending ? "Caricamento…" : "Carica documenti"}
        </button>
      </footer>
    </Modal>
  );
}

export function SearchPanel({
  session,
  studio,
  onSource,
  onAttach,
  close,
}: {
  session: Session;
  studio: Studio;
  onSource: (s: Source) => void;
  onAttach: (id: number) => Promise<void>;
  close: () => void;
}) {
  const [q, setQ] = useState(""),
    [result, setResult] = useState<{
      sources: Source[];
      method: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    try {
      setResult(
        await api("/matters/" + session.matter + "/search", "POST", {
          query: q,
        }),
      );
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Cerca nel fascicolo" onClose={close}>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input
          autoFocus
          required
          aria-label="Termine di ricerca"
          placeholder="Cerca una clausola, un articolo o un concetto…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="primary" disabled={busy || !q.trim()}>
          <Search size={16} />
          {busy ? "Ricerca…" : "Cerca"}
        </button>
      </form>
      <p className="muted">
        {studio.online && studio.settings.semantic
          ? "La ricerca semantica indicizza i passaggi con Gemini Embedding (solo cartelle attive)."
          : "Ricerca testuale nei documenti della pratica e nelle cartelle attive."}
      </p>
      {result && (
        <>
          <h3>{result.method}</h3>
          {!result.sources.length && <p>Nessun passaggio trovato.</p>}
          {result.sources.map((s) => (
            <div className="search-hit" key={s.id}>
              <button
                type="button"
                className="source-link"
                onClick={() => onSource(s)}
              >
                <FileText size={15} />
                {s.name} · {s.label}
              </button>
              <p>{s.quote}</p>
              <button
                type="button"
                className="outline"
                disabled={session.selected.includes(s.doc)}
                onClick={() =>
                  void onAttach(s.doc).catch((e) => setError(err(e)))
                }
              >
                {session.selected.includes(s.doc) ? (
                  <Check size={14} />
                ) : (
                  <Plus size={14} />
                )}{" "}
                {session.selected.includes(s.doc)
                  ? "Nel contesto"
                  : "Aggiungi documento intero"}
              </button>
            </div>
          ))}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
