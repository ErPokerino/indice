import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
MODELS = {"gemini-4-hydrogen": "Hydrogen", "gemini-4-neon": "Neon"}
LEVELS = {"low": "Basso", "medium": "Medio", "high": "Alto", "xhigh": "Massimo"}
TOOLS = {
    "search": "Cerca nel fascicolo",
    "read": "Leggi passaggi",
    "open": "Apri documenti interi",
    "template": "Genera da modelli di documenti",
    "analytics": "Tabelle, grafici e timeline",
}
DEFAULT_PROMPT = (
    "Sei un assistente per uno studio legale italiano. Rispondi nella lingua della domanda. "
    "Distingui i fatti documentati dalle ipotesi. Quando manca un riscontro, dichiaralo. "
    "Quando compili un modello di documento, integra tutte le indicazioni fornite dall'utente in chat "
    "e chiedi o segnala con [DA COMPLETARE: ...] solo i dati mancanti. "
    "Quando utile o richiesto, presenta i dati comparativi e cronologici con tabelle strutturate o grafici."
)


def data_dir():
    path = Path(os.getenv("INDICE_DATA_DIR", str(ROOT / ".indice"))).resolve()
    (path / "files").mkdir(parents=True, exist_ok=True)
    return path


def mask_key(val: str) -> str:
    if not val:
        return ""
    if len(val) <= 8:
        return "••••"
    return f"{val[:4]}••••{val[-4:]}"


def _db_api_key() -> str:
    db_path = data_dir() / "indice.sqlite3"
    if not db_path.exists():
        return ""
    try:
        con = sqlite3.connect(db_path, timeout=5)
        try:
            row = con.execute(
                "SELECT value FROM secrets WHERE name='gemini_api_key'"
            ).fetchone()
            return (row[0] or "").strip() if row else ""
        finally:
            con.close()
    except sqlite3.Error:
        return ""


def key_info() -> dict:
    db_val = _db_api_key()
    if db_val:
        return {
            "key": db_val,
            "source": "app",
            "configured": True,
            "masked": mask_key(db_val),
        }
    if "GEMINI_API_KEY" in os.environ or "GOOGLE_API_KEY" in os.environ:
        env_val = (
            os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
        ).strip()
        return {
            "key": env_val,
            "source": "env" if env_val else "none",
            "configured": bool(env_val),
            "masked": mask_key(env_val),
        }
    values = dotenv_values(ROOT / ".env")
    dotenv_val = (
        values.get("GEMINI_API_KEY") or values.get("GOOGLE_API_KEY") or ""
    ).strip()
    if dotenv_val:
        return {
            "key": dotenv_val,
            "source": "dotenv",
            "configured": True,
            "masked": mask_key(dotenv_val),
        }
    return {"key": "", "source": "none", "configured": False, "masked": ""}


def public_key_info() -> dict:
    info = key_info()
    return {
        "configured": info["configured"],
        "source": info["source"],
        "masked": info["masked"],
    }


def key() -> str:
    return key_info()["key"]


def save_api_key(con, raw_key: str) -> dict:
    cleaned = raw_key.strip()
    if not cleaned:
        con.execute("DELETE FROM secrets WHERE name='gemini_api_key'")
    else:
        con.execute(
            "INSERT INTO secrets(name, value, updated_at) VALUES('gemini_api_key', ?, CURRENT_TIMESTAMP) "
            "ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
            (cleaned,),
        )
    return {
        "configured": bool(cleaned),
        "source": "app" if cleaned else public_key_info()["source"],
        "masked": mask_key(cleaned),
    }


def dump(value):
    return json.dumps(value, ensure_ascii=False)


@contextmanager
def db():
    con = sqlite3.connect(data_dir() / "indice.sqlite3", timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    try:
        with con:
            yield con
    finally:
        con.close()


def rows(con, sql, args=()):
    return [dict(r) for r in con.execute(sql, args)]


def settings(con):
    return json.loads(
        con.execute("SELECT value FROM configs ORDER BY id DESC LIMIT 1").fetchone()[0]
    )


def _ensure_column(con, table: str, column: str, definition: str):
    existing = {
        r["name"] for r in con.execute(f"PRAGMA table_info({table})").fetchall()
    }
    if column not in existing:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def setup(con):
    con.executescript("""
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS matters(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS matter_folders(
        id INTEGER PRIMARY KEY,
        matter INTEGER NOT NULL REFERENCES matters,
        label TEXT NOT NULL,
        path TEXT NOT NULL,
        recursive INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_sync TEXT,
        file_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(matter, path)
    );
    CREATE TABLE IF NOT EXISTS docs(
        id INTEGER PRIMARY KEY,
        matter INTEGER NOT NULL REFERENCES matters,
        name TEXT NOT NULL,
        file TEXT NOT NULL,
        mime TEXT,
        pages INTEGER NOT NULL,
        folder_id INTEGER,
        rel_path TEXT,
        source_mtime REAL,
        UNIQUE(matter,name,file)
    );
    CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, doc INTEGER NOT NULL REFERENCES docs, page INTEGER, label TEXT, text TEXT NOT NULL, rects TEXT, visual INTEGER NOT NULL DEFAULT 0, vector BLOB);
    CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc);
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(text, tokenize='unicode61 remove_diacritics 2');
    CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, matter INTEGER NOT NULL REFERENCES matters, title TEXT, selected TEXT NOT NULL, model TEXT, level TEXT, revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS turns(id INTEGER PRIMARY KEY, session INTEGER NOT NULL REFERENCES sessions, request TEXT NOT NULL, result TEXT NOT NULL, nonce TEXT, UNIQUE(session,nonce));
    CREATE TABLE IF NOT EXISTS configs(id INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS templates(
        id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL,
        name TEXT NOT NULL UNIQUE,
        purpose TEXT,
        sections TEXT,
        fields TEXT,
        instructions TEXT,
        category TEXT NOT NULL DEFAULT 'Generale',
        tone TEXT NOT NULL DEFAULT 'Professionale chiaro',
        audience TEXT NOT NULL DEFAULT 'Cliente',
        jurisdiction TEXT NOT NULL DEFAULT 'Diritto italiano',
        output_format TEXT NOT NULL DEFAULT 'Documento strutturato',
        clause_rules TEXT NOT NULL DEFAULT '',
        custom_attrs TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS template_examples(
        id INTEGER PRIMARY KEY,
        template_id INTEGER NOT NULL REFERENCES templates,
        name TEXT NOT NULL,
        file TEXT,
        mime TEXT,
        extracted_text TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS secrets(
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    """)
    _ensure_column(con, "docs", "folder_id", "INTEGER")
    _ensure_column(con, "docs", "rel_path", "TEXT")
    _ensure_column(con, "docs", "source_mtime", "REAL")
    _ensure_column(con, "templates", "category", "TEXT NOT NULL DEFAULT 'Generale'")
    _ensure_column(
        con, "templates", "tone", "TEXT NOT NULL DEFAULT 'Professionale chiaro'"
    )
    _ensure_column(con, "templates", "audience", "TEXT NOT NULL DEFAULT 'Cliente'")
    _ensure_column(
        con, "templates", "jurisdiction", "TEXT NOT NULL DEFAULT 'Diritto italiano'"
    )
    _ensure_column(
        con,
        "templates",
        "output_format",
        "TEXT NOT NULL DEFAULT 'Documento strutturato'",
    )
    _ensure_column(con, "templates", "clause_rules", "TEXT NOT NULL DEFAULT ''")
    _ensure_column(con, "templates", "custom_attrs", "TEXT NOT NULL DEFAULT '[]'")


def cleanup_orphan_files(con, filenames):
    files_dir = data_dir() / "files"
    for fname in set(filenames or []):
        if not fname:
            continue
        in_docs = con.execute(
            "SELECT 1 FROM docs WHERE file=? LIMIT 1", (fname,)
        ).fetchone()
        in_examples = con.execute(
            "SELECT 1 FROM template_examples WHERE file=? LIMIT 1", (fname,)
        ).fetchone()
        if not in_docs and not in_examples:
            target = files_dir / fname
            if target.exists():
                try:
                    target.unlink()
                except OSError:
                    pass


def new_session(con, matter, title, selected=None):
    cfg = settings(con)
    return con.execute(
        "INSERT INTO sessions(matter,title,selected,model,level) VALUES(?,?,?,?,?)",
        (matter, title, dump(selected or []), cfg["model"], cfg["level"]),
    ).lastrowid
