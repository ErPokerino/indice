import json
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlparse
from uuid import uuid4

import httpx
from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import gemini, orchestrator, search as search_mod
from .assistant import answer, prepare
from .demo import initialize
from .documents import (
    browse_directories,
    delete_doc,
    export_markdown_to_docx,
    extract_plain_text,
    ingest,
    sync_folder,
)
from .search import public, search
from .store import (
    LEVELS,
    MODELS,
    ROOT,
    TOOLS,
    cleanup_orphan_files,
    data_dir,
    db,
    dump,
    key,
    new_session,
    public_key_info,
    rows,
    save_api_key,
    settings,
)


@asynccontextmanager
async def lifespan(app):
    initialize()
    yield


app = FastAPI(title="Indice", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"],
)


@app.middleware("http")
async def local_writes(request: Request, call_next):
    origin = request.headers.get("origin")
    if (
        request.method not in ("GET", "HEAD", "OPTIONS")
        and origin
        and urlparse(origin).hostname not in ("localhost", "127.0.0.1", "::1")
    ):
        return JSONResponse({"detail": "Origine non autorizzata."}, status_code=403)
    return await call_next(request)


class Name(BaseModel):
    name: str = Field(min_length=1, max_length=160, pattern=r"\S")


class Prefs(BaseModel):
    model: Literal["gemini-4-hydrogen", "gemini-4-neon"]
    level: Literal["low", "medium", "high", "xhigh"]


class EditSession(Prefs):
    selected: list[int]
    revision: int


class Config(Prefs):
    prompt: str = Field(min_length=1, max_length=40000)
    tools: list[Literal["search", "open", "read", "template", "analytics"]]
    semantic: bool
    version: int


class ApiKeyPayload(BaseModel):
    apiKey: str = Field(default="", max_length=500)


class CustomAttr(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    value: str = Field(default="", max_length=500)


class Template(Name):
    purpose: str = ""
    sections: str = ""
    fields: str = ""
    instructions: str = ""
    category: str = "Generale"
    tone: str = "Professionale chiaro"
    audience: str = "Cliente"
    jurisdiction: str = "Diritto italiano"
    output_format: str = "Documento strutturato"
    clause_rules: str = ""
    custom_attrs: list[CustomAttr] = Field(default_factory=list)
    version: int = 0


class TemplateExampleText(BaseModel):
    name: str = Field(min_length=1, max_length=160, pattern=r"\S")
    text: str = Field(min_length=1, max_length=30000)
    notes: str = Field(default="", max_length=1000)


class Draft(BaseModel):
    question: str = Field(default="", max_length=100000)
    archive: bool = False
    template: int | None = None
    field_values: dict[str, str] = Field(default_factory=dict)
    output_mode: Literal["auto", "table", "chart", "document"] = "auto"


class Send(Draft):
    nonce: str = Field(min_length=8, max_length=120)
    revision: int


class Search(BaseModel):
    query: str = Field(min_length=1, max_length=3000)


class FolderCreate(BaseModel):
    path: str = Field(min_length=1, max_length=1000, pattern=r"\S")
    label: str = Field(default="", max_length=160)
    recursive: bool = True
    enabled: bool = True


class FolderUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=160)
    recursive: bool | None = None
    enabled: bool | None = None


class DocxExport(BaseModel):
    title: str = Field(default="Documento legale", max_length=200)
    content: str = Field(min_length=1, max_length=300000)


def must(con, table, i):
    r = con.execute(f"SELECT * FROM {table} WHERE id=?", (i,)).fetchone()
    if not r:
        raise HTTPException(404, "Elemento non trovato.")
    return dict(r)


def _clear_ai_caches():
    orchestrator.interpret.cache_clear()
    gemini.input_limit.cache_clear()
    gemini.uploaded_uri.cache_clear()
    search_mod.query_vector.cache_clear()


def _serialize_template(con, r: dict) -> dict:
    out = dict(r)
    try:
        out["custom_attrs"] = json.loads(out.get("custom_attrs") or "[]")
    except ValueError:
        out["custom_attrs"] = []
    exs = rows(
        con,
        "SELECT id, name, mime, notes, extracted_text FROM template_examples WHERE template_id=? ORDER BY id",
        (out["id"],),
    )
    out["examples"] = [
        {
            "id": e["id"],
            "name": e["name"],
            "mime": e["mime"],
            "notes": e["notes"],
            "preview": e["extracted_text"][:280],
            "length": len(e["extracted_text"]),
        }
        for e in exs
    ]
    return out


def _serialize_folder(r: dict) -> dict:
    p = Path(r["path"])
    return {
        "id": r["id"],
        "matter": r["matter"],
        "label": r["label"],
        "path": r["path"],
        "recursive": bool(r["recursive"]),
        "enabled": bool(r["enabled"]),
        "lastSync": r["last_sync"],
        "fileCount": r["file_count"],
        "exists": p.exists() and p.is_dir(),
    }


@app.get("/api/studio")
def studio():
    with db() as con:
        matters_raw = rows(con, "SELECT * FROM matters ORDER BY id")
        matters = []
        for m in matters_raw:
            mid = m["id"]
            matters.append(
                {
                    **m,
                    "docCount": con.execute(
                        "SELECT COUNT(*) FROM docs WHERE matter=?", (mid,)
                    ).fetchone()[0],
                    "sessionCount": con.execute(
                        "SELECT COUNT(*) FROM sessions WHERE matter=?", (mid,)
                    ).fetchone()[0],
                    "folderCount": con.execute(
                        "SELECT COUNT(*) FROM matter_folders WHERE matter=?", (mid,)
                    ).fetchone()[0],
                }
            )
        templates = [
            _serialize_template(con, t)
            for t in rows(con, "SELECT * FROM templates ORDER BY name")
        ]
        return {
            "matters": matters,
            "sessions": rows(
                con, "SELECT id,matter,title FROM sessions ORDER BY id DESC"
            ),
            "settings": settings(con),
            "templates": templates,
            "online": bool(key()),
            "apiKey": public_key_info(),
            "models": MODELS,
            "levels": LEVELS,
            "tools": TOOLS,
            "agentBlueprint": orchestrator.blueprint(),
        }


@app.put("/api/config/api-key")
def update_api_key(form: ApiKeyPayload):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        save_api_key(con, form.apiKey)
    _clear_ai_caches()
    return {"online": bool(key()), "apiKey": public_key_info()}


@app.post("/api/config/api-key/test")
def test_api_key(form: ApiKeyPayload):
    candidate = form.apiKey.strip() or key()
    if not candidate:
        raise HTTPException(400, "Inserisci una chiave API Gemini per verificare la connessione.")
    try:
        res = httpx.get(
            gemini.BASE + "gemini-4-hydrogen",
            headers={"x-goog-api-key": candidate},
            timeout=20,
        )
    except httpx.RequestError as e:
        raise HTTPException(
            503, "Gemini non raggiungibile. Verifica la connessione internet e riprova."
        ) from e
    if res.is_error:
        if res.status_code in (401, 403):
            raise HTTPException(400, "Chiave Gemini non valida o priva di autorizzazione.")
        raise HTTPException(502, f"Verifica Gemini non riuscita (HTTP {res.status_code}).")
    return {"ok": True, "detail": "Connessione Gemini verificata correttamente."}


@app.post("/api/matters")
def create_matter(form: Name):
    with db() as con:
        m = con.execute(
            "INSERT INTO matters(name) VALUES(?)", (form.name.strip(),)
        ).lastrowid
        return {"id": m, "session": new_session(con, m, "Nuova conversazione")}


@app.delete("/api/matters/{m}")
def delete_matter(m: int):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        must(con, "matters", m)
        doc_rows = con.execute(
            "SELECT id, file FROM docs WHERE matter=?", (m,)
        ).fetchall()
        files_to_check = [r["file"] for r in doc_rows]
        for dr in doc_rows:
            cids = [
                c[0]
                for c in con.execute(
                    "SELECT id FROM chunks WHERE doc=?", (dr["id"],)
                ).fetchall()
            ]
            for cid in cids:
                con.execute("DELETE FROM search_index WHERE rowid=?", (cid,))
            con.execute("DELETE FROM chunks WHERE doc=?", (dr["id"],))
        con.execute("DELETE FROM docs WHERE matter=?", (m,))
        con.execute("DELETE FROM matter_folders WHERE matter=?", (m,))
        sids = [
            r[0]
            for r in con.execute(
                "SELECT id FROM sessions WHERE matter=?", (m,)
            ).fetchall()
        ]
        for sid in sids:
            con.execute("DELETE FROM turns WHERE session=?", (sid,))
        con.execute("DELETE FROM sessions WHERE matter=?", (m,))
        con.execute("DELETE FROM matters WHERE id=?", (m,))
        cleanup_orphan_files(con, files_to_check)
        next_row = con.execute(
            "SELECT id FROM sessions ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return {"deleted": m, "nextSession": next_row[0] if next_row else None}


@app.post("/api/matters/{m}/sessions")
def create_session(m: int, form: Name):
    with db() as con:
        must(con, "matters", m)
        default = con.execute(
            "SELECT id FROM docs WHERE matter=? ORDER BY id LIMIT 1", (m,)
        ).fetchone()
        return {
            "id": new_session(
                con, m, form.name.strip(), [default[0]] if default else []
            )
        }


@app.delete("/api/sessions/{sid}")
def delete_session(sid: int):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        s = must(con, "sessions", sid)
        matter_id = s["matter"]
        con.execute("DELETE FROM turns WHERE session=?", (sid,))
        con.execute("DELETE FROM sessions WHERE id=?", (sid,))
        remaining = con.execute(
            "SELECT id FROM sessions WHERE matter=? ORDER BY id DESC LIMIT 1",
            (matter_id,),
        ).fetchone()
        if remaining:
            next_id = remaining[0]
        else:
            default = con.execute(
                "SELECT id FROM docs WHERE matter=? ORDER BY id LIMIT 1", (matter_id,)
            ).fetchone()
            next_id = new_session(
                con,
                matter_id,
                "Nuova conversazione",
                [default[0]] if default else [],
            )
        return {"deleted": sid, "nextSession": next_id}


def session_data(con, sid):
    s = must(con, "sessions", sid)
    s["selected"] = json.loads(s["selected"])
    s["docs"] = rows(
        con,
        """SELECT d.id, d.name, d.mime, d.pages,
                  d.folder_id AS folderId, d.rel_path AS relPath,
                  f.label AS folderLabel,
                  COALESCE(f.enabled, 1) AS folderEnabled
           FROM docs d
           LEFT JOIN matter_folders f ON f.id = d.folder_id
           WHERE d.matter=? ORDER BY d.id""",
        (s["matter"],),
    )
    for d in s["docs"]:
        d["folderEnabled"] = bool(d["folderEnabled"])
    visual_pages = rows(
        con,
        "SELECT DISTINCT c.doc,c.page FROM chunks c JOIN docs d ON d.id=c.doc WHERE d.matter=? AND c.visual=1",
        (s["matter"],),
    )
    for doc in s["docs"]:
        doc["visualPages"] = [p["page"] for p in visual_pages if p["doc"] == doc["id"]]
    s["folders"] = [
        _serialize_folder(f)
        for f in rows(
            con,
            "SELECT * FROM matter_folders WHERE matter=? ORDER BY id",
            (s["matter"],),
        )
    ]
    s["turns"] = [
        dict(id=r["id"], question=r["request"], **json.loads(r["result"]))
        for r in con.execute("SELECT * FROM turns WHERE session=? ORDER BY id", (sid,))
    ]
    return s


@app.get("/api/sessions/{sid}")
def get_session(sid: int):
    with db() as con:
        return session_data(con, sid)


@app.put("/api/sessions/{sid}")
def edit_session(sid: int, form: EditSession):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        s = must(con, "sessions", sid)
        if s["revision"] != form.revision:
            raise HTTPException(409, "La sessione è cambiata. Aggiorna la pagina.")
        valid = {
            r[0]
            for r in con.execute("SELECT id FROM docs WHERE matter=?", (s["matter"],))
        }
        if set(form.selected) - valid:
            raise HTTPException(422, "Documento esterno alla pratica.")
        con.execute(
            "UPDATE sessions SET model=?,level=?,selected=?,revision=revision+1 WHERE id=?",
            (form.model, form.level, dump(list(dict.fromkeys(form.selected))), sid),
        )
        return session_data(con, sid)


@app.post("/api/sessions/{sid}/upload")
def upload(sid: int, file: UploadFile, attach: bool = Form(False)):
    raw = file.file.read(32 * 1024 * 1024 + 1)
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        s = must(con, "sessions", sid)
        i = ingest(con, s["matter"], file.filename or "", raw)
        selected = json.loads(s["selected"])
        if attach and i not in selected:
            selected.append(i)
        con.execute(
            "UPDATE sessions SET selected=?,revision=revision+1 WHERE id=?",
            (dump(selected), sid),
        )
        return {"doc": i, "session": session_data(con, sid)}


@app.delete("/api/docs/{i}")
def remove_doc(i: int):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        d = must(con, "docs", i)
        delete_doc(con, i)
        if d["folder_id"]:
            count = con.execute(
                "SELECT COUNT(*) FROM docs WHERE folder_id=?", (d["folder_id"],)
            ).fetchone()[0]
            con.execute(
                "UPDATE matter_folders SET file_count=? WHERE id=?",
                (count, d["folder_id"]),
            )
        return {"deleted": i}


@app.get("/api/docs/{i}/original")
def original(i: int):
    with db() as con:
        r = must(con, "docs", i)
    return FileResponse(
        data_dir() / "files" / r["file"],
        media_type=r["mime"],
        filename=r["name"],
        content_disposition_type="inline",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@app.get("/api/docs/{i}/passages")
def passages(i: int):
    with db() as con:
        r = must(con, "docs", i)
        return [
            public(dict(c, name=r["name"]))
            for c in con.execute("SELECT * FROM chunks WHERE doc=? ORDER BY id", (i,))
        ]


@app.get("/api/fs/browse")
def fs_browse(path: str = ""):
    return browse_directories(path)


@app.get("/api/matters/{m}/folders")
def list_folders(m: int):
    with db() as con:
        must(con, "matters", m)
        return [
            _serialize_folder(f)
            for f in rows(
                con, "SELECT * FROM matter_folders WHERE matter=? ORDER BY id", (m,)
            )
        ]


@app.post("/api/matters/{m}/folders")
def add_folder(m: int, form: FolderCreate):
    target = Path(form.path.strip()).expanduser()
    try:
        resolved = str(target.resolve())
    except OSError as e:
        raise HTTPException(400, f"Percorso non valido: {e}") from e
    if not Path(resolved).exists() or not Path(resolved).is_dir():
        raise HTTPException(404, f"Cartella non trovata: {form.path}")
    label = form.label.strip() or Path(resolved).name or resolved
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        must(con, "matters", m)
        try:
            fid = con.execute(
                "INSERT INTO matter_folders(matter,label,path,recursive,enabled) VALUES(?,?,?,?,?)",
                (m, label, resolved, int(form.recursive), int(form.enabled)),
            ).lastrowid
        except sqlite3.IntegrityError as e:
            raise HTTPException(
                409, "Questa cartella è già collegata alla pratica."
            ) from e
        folder_row = must(con, "matter_folders", fid)
        summary = sync_folder(con, folder_row)
        return {"folder": _serialize_folder(must(con, "matter_folders", fid)), "sync": summary}


@app.put("/api/matters/{m}/folders/{fid}")
def update_folder(m: int, fid: int, form: FolderUpdate):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        must(con, "matters", m)
        folder = must(con, "matter_folders", fid)
        if folder["matter"] != m:
            raise HTTPException(404, "Cartella non appartenente alla pratica.")
        label = form.label.strip() if form.label is not None and form.label.strip() else folder["label"]
        recursive = int(form.recursive) if form.recursive is not None else folder["recursive"]
        enabled = int(form.enabled) if form.enabled is not None else folder["enabled"]
        con.execute(
            "UPDATE matter_folders SET label=?, recursive=?, enabled=? WHERE id=?",
            (label, recursive, enabled, fid),
        )
        return _serialize_folder(must(con, "matter_folders", fid))


@app.post("/api/matters/{m}/folders/{fid}/sync")
def sync_matter_folder(m: int, fid: int):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        must(con, "matters", m)
        folder = must(con, "matter_folders", fid)
        if folder["matter"] != m:
            raise HTTPException(404, "Cartella non appartenente alla pratica.")
        summary = sync_folder(con, folder)
        return {"folder": _serialize_folder(must(con, "matter_folders", fid)), "sync": summary}


@app.delete("/api/matters/{m}/folders/{fid}")
def remove_folder(m: int, fid: int):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        must(con, "matters", m)
        folder = must(con, "matter_folders", fid)
        if folder["matter"] != m:
            raise HTTPException(404, "Cartella non appartenente alla pratica.")
        doc_ids = [
            r[0]
            for r in con.execute(
                "SELECT id FROM docs WHERE folder_id=?", (fid,)
            ).fetchall()
        ]
        for did in doc_ids:
            delete_doc(con, did)
        con.execute("DELETE FROM matter_folders WHERE id=?", (fid,))
        return {"deleted": fid, "removedDocs": len(doc_ids)}


@app.post("/api/matters/{m}/search")
def search_matter(m: int, form: Search):
    with db() as con:
        must(con, "matters", m)
        cfg = settings(con)
        if "search" not in cfg["tools"]:
            raise HTTPException(409, "Ricerca disattivata in Configurazione.")
        found, method = search(con, m, form.query, cfg["semantic"])
        return {"method": method, "sources": [public(r) for r in found]}


@app.post("/api/sessions/{sid}/context")
def context(sid: int, form: Draft):
    with db() as con:
        work = prepare(con, sid, form, route_live=True)
        return gemini.count(work["session"]["model"], work["body"])


@app.post("/api/sessions/{sid}/send")
def send(sid: int, form: Send):
    if not form.question.strip():
        raise HTTPException(422, "Scrivi una domanda.")
    with db() as con:
        old = con.execute(
            "SELECT 1 FROM turns WHERE session=? AND nonce=?", (sid, form.nonce)
        ).fetchone()
        if old:
            return session_data(con, sid)
        work = prepare(con, sid, form, route_live=True)
        if work["session"]["revision"] != form.revision:
            raise HTTPException(
                409, "La sessione è cambiata. Riaprila prima di inviare."
            )
        result = answer(work)
        con.execute("BEGIN IMMEDIATE")
        if con.execute(
            "SELECT 1 FROM turns WHERE session=? AND nonce=?", (sid, form.nonce)
        ).fetchone():
            return session_data(con, sid)
        title = work["session"]["title"]
        if title == "Nuova conversazione":
            title = form.question.strip()[:65]
        updated = con.execute(
            "UPDATE sessions SET revision=revision+1,title=? WHERE id=? AND revision=?",
            (title, sid, form.revision),
        )
        if not updated.rowcount:
            raise HTTPException(
                409, "La sessione è cambiata durante la risposta. Riaprila e riprova."
            )
        con.execute(
            "INSERT INTO turns(session,request,result,nonce) VALUES(?,?,?,?)",
            (sid, form.question.strip(), dump(result), form.nonce),
        )
        return session_data(con, sid)


@app.put("/api/config")
def config(form: Config):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        current = settings(con)
        if current["version"] != form.version:
            raise HTTPException(
                409, "La configurazione è stata modificata. Riapri la finestra."
            )
        value = form.model_dump()
        value["version"] += 1
        con.execute("INSERT INTO configs VALUES(?,?)", (value["version"], dump(value)))
        return value


@app.get("/api/config/{version}")
def get_version(version: int):
    with db() as con:
        return json.loads(must(con, "configs", version)["value"])


def save_template(con, form: Template, i=None):
    attrs_json = dump([a.model_dump() for a in form.custom_attrs if a.key.strip()])
    args = (
        form.name.strip(),
        form.purpose,
        form.sections,
        form.fields,
        form.instructions,
        form.category.strip() or "Generale",
        form.tone.strip() or "Professionale chiaro",
        form.audience.strip() or "Cliente",
        form.jurisdiction.strip() or "Diritto italiano",
        form.output_format.strip() or "Documento strutturato",
        form.clause_rules,
        attrs_json,
    )
    try:
        if i is None:
            i = con.execute(
                """INSERT INTO templates(
                    version,name,purpose,sections,fields,instructions,
                    category,tone,audience,jurisdiction,output_format,clause_rules,custom_attrs
                ) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?)""",
                args,
            ).lastrowid
        else:
            if not con.execute(
                """UPDATE templates SET version=version+1,
                   name=?,purpose=?,sections=?,fields=?,instructions=?,
                   category=?,tone=?,audience=?,jurisdiction=?,output_format=?,clause_rules=?,custom_attrs=?
                   WHERE id=? AND version=?""",
                (*args, i, form.version),
            ).rowcount:
                raise HTTPException(
                    409, "Il modello di documento è cambiato. Riapri la finestra."
                )
    except sqlite3.IntegrityError as e:
        raise HTTPException(
            409, "Esiste già un modello di documento con questo nome."
        ) from e
    return _serialize_template(con, must(con, "templates", i))


@app.post("/api/templates")
def add_template(form: Template):
    with db() as con:
        return save_template(con, form)


@app.put("/api/templates/{i}")
def edit_template(i: int, form: Template):
    with db() as con:
        return save_template(con, form, i)


@app.delete("/api/templates/{i}")
def delete_template(i: int):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        must(con, "templates", i)
        ex_files = [
            r[0]
            for r in con.execute(
                "SELECT file FROM template_examples WHERE template_id=? AND file IS NOT NULL",
                (i,),
            ).fetchall()
        ]
        con.execute("DELETE FROM template_examples WHERE template_id=?", (i,))
        con.execute("DELETE FROM templates WHERE id=?", (i,))
        cleanup_orphan_files(con, ex_files)
        return {"deleted": i}


@app.post("/api/templates/{i}/examples/file")
def add_template_example_file(
    i: int, file: UploadFile, notes: str = Form("")
):
    raw = file.file.read(32 * 1024 * 1024 + 1)
    name = Path((file.filename or "esempio.txt").replace("\\", "/")).name
    mime, text = extract_plain_text(name, raw)
    ext = Path(name).suffix.lower()
    fname = f"ex-{uuid4().hex}{ext}"
    target = data_dir() / "files" / fname
    target.write_bytes(raw)
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        must(con, "templates", i)
        con.execute(
            "INSERT INTO template_examples(template_id,name,file,mime,extracted_text,notes) VALUES(?,?,?,?,?,?)",
            (i, name, fname, mime, text, notes.strip()),
        )
        return _serialize_template(con, must(con, "templates", i))


@app.post("/api/templates/{i}/examples/text")
def add_template_example_text(i: int, form: TemplateExampleText):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        must(con, "templates", i)
        con.execute(
            "INSERT INTO template_examples(template_id,name,file,mime,extracted_text,notes) VALUES(?,?,?,?,?,?)",
            (
                i,
                form.name.strip(),
                None,
                "text/plain",
                form.text.strip(),
                form.notes.strip(),
            ),
        )
        return _serialize_template(con, must(con, "templates", i))


@app.delete("/api/templates/{i}/examples/{eid}")
def delete_template_example(i: int, eid: int):
    with db() as con:
        con.execute("BEGIN IMMEDIATE")
        must(con, "templates", i)
        ex = must(con, "template_examples", eid)
        if ex["template_id"] != i:
            raise HTTPException(404, "Esempio non appartenente al modello.")
        con.execute("DELETE FROM template_examples WHERE id=?", (eid,))
        if ex["file"]:
            cleanup_orphan_files(con, [ex["file"]])
        return _serialize_template(con, must(con, "templates", i))


@app.post("/api/export/docx")
def export_docx(form: DocxExport):
    data = export_markdown_to_docx(form.title, form.content)
    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in form.title).strip() or "documento"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(safe)}.docx",
            "X-Content-Type-Options": "nosniff",
        },
    )


if (ROOT / "dist").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="frontend")
