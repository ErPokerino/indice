import csv
import hashlib
import io
import json
import os
import re
import string
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pymupdf as fitz
from docx import Document
from docx.shared import Pt
from docx.table import Table
from fastapi import HTTPException
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from PIL import Image

from .store import ROOT, cleanup_orphan_files, data_dir, dump

MIME = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    ".indice",
    ".ruff_cache",
    "dist",
    "build",
    "$RECYCLE.BIN",
    "System Volume Information",
}
MAX_FOLDER_FILES = 200


def fragment(label, text, page=None, rects=None, visual=False):
    return (page, label, text, dump(rects or []), int(visual))


def blocks(label, text):
    for start in range(0, len(text), 3000):
        yield fragment(label, text[start : start + 3000])


def extract(raw, ext):
    stream = io.BytesIO(raw)
    parts = []
    pages = 1
    if ext in (".docx", ".xlsx"):
        with zipfile.ZipFile(stream) as z:
            if sum(i.file_size for i in z.infolist()) > 100_000_000:
                raise ValueError(
                    "Documento Office troppo grande dopo la decompressione."
                )
        stream.seek(0)
    if ext == ".pdf":
        with fitz.open(stream=raw, filetype="pdf") as pdf:
            if pdf.needs_pass or not len(pdf):
                raise ValueError("Il PDF è vuoto o protetto da password.")
            pages = len(pdf)
            for i, page in enumerate(pdf, 1):
                before = len(parts)
                for block in page.get_text("blocks", sort=True):
                    content = block[4].strip()
                    if not content or (len(block) > 6 and block[6] != 0):
                        continue
                    rect = fitz.Rect(block[:4]) * page.rotation_matrix
                    w, h = page.rect.width, page.rect.height
                    box = [rect.x0 / w, rect.y0 / h, rect.x1 / w, rect.y1 / h]
                    for start in range(0, len(content), 3000):
                        parts.append(
                            fragment(f"p. {i}", content[start : start + 3000], i, [box])
                        )
                if before == len(parts):
                    parts.append(fragment(f"p. {i}", "", i, visual=True))
    elif ext in (".jpg", ".jpeg", ".png"):
        with Image.open(stream) as img:
            if img.format != ("PNG" if ext == ".png" else "JPEG"):
                raise ValueError("Il contenuto non corrisponde al formato immagine.")
            img.verify()
        parts.append(fragment("Immagine", "", 1, visual=True))
    elif ext == ".docx":
        doc = Document(stream)
        for i, item in enumerate(doc.iter_inner_content(), 1):
            if isinstance(item, Table):
                for n, row in enumerate(item.rows, 1):
                    parts.extend(
                        blocks(
                            f"Tabella {i} · riga {n}",
                            " | ".join(c.text for c in row.cells),
                        )
                    )
            elif item.text.strip():
                parts.extend(blocks(f"Paragrafo {i}", item.text))
    elif ext == ".xlsx":
        book = load_workbook(stream, read_only=True, data_only=False)
        try:
            for sheet in book:
                for row in sheet.iter_rows():
                    for cell in row:
                        if cell.value is not None:
                            parts.extend(
                                blocks(
                                    f"{sheet.title}!{cell.coordinate}", str(cell.value)
                                )
                            )
        finally:
            book.close()
    else:
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            content = raw.decode("cp1252")
        if "\x00" in content:
            raise ValueError("Il file non contiene testo leggibile.")
        if ext == ".csv":
            try:
                dialect = csv.Sniffer().sniff(content[:8192], delimiters=",;\t")
            except csv.Error:
                dialect = csv.excel
            for r, row in enumerate(csv.reader(io.StringIO(content), dialect), 1):
                for c, value in enumerate(row, 1):
                    if value:
                        parts.extend(blocks(f"{get_column_letter(c)}{r}", value))
        else:
            for n, line in enumerate(content.splitlines(), 1):
                if line.strip():
                    parts.extend(blocks(f"Riga {n}", line))
    if not parts:
        raise ValueError("Il documento non contiene dati leggibili.")
    return pages, parts


def extract_plain_text(name: str, raw: bytes) -> tuple[str, str]:
    clean_name = Path(name.replace("\\", "/")).name
    ext = Path(clean_name).suffix.lower()
    if ext not in MIME or ext in (".png", ".jpg", ".jpeg"):
        raise HTTPException(
            415,
            "Formato esempio non supportato. Usa PDF, DOCX, TXT, MD, CSV o XLSX.",
        )
    if not raw or len(raw) > 32 * 1024 * 1024:
        raise HTTPException(413, "Carica un file non vuoto di massimo 32 MB.")
    try:
        _, parts = extract(raw, ext)
    except Exception as e:
        raise HTTPException(422, f"Impossibile leggere {clean_name}. {e}") from e
    text = "\n".join(p[2] for p in parts if p[2].strip())
    if not text.strip():
        raise HTTPException(
            422, "L'esempio allegato non contiene testo estraibile utilizzabile."
        )
    return MIME[ext], text[:24000]


def delete_doc(con, doc_id: int):
    doc = con.execute("SELECT id, matter, file FROM docs WHERE id=?", (doc_id,)).fetchone()
    if not doc:
        return
    cids = [
        r[0]
        for r in con.execute("SELECT id FROM chunks WHERE doc=?", (doc_id,)).fetchall()
    ]
    for cid in cids:
        con.execute("DELETE FROM search_index WHERE rowid=?", (cid,))
    con.execute("DELETE FROM chunks WHERE doc=?", (doc_id,))
    con.execute("DELETE FROM docs WHERE id=?", (doc_id,))
    for s in con.execute(
        "SELECT id, selected FROM sessions WHERE matter=?", (doc["matter"],)
    ).fetchall():
        sel = [i for i in json.loads(s["selected"]) if i != doc_id]
        con.execute(
            "UPDATE sessions SET selected=? WHERE id=?", (dump(sel), s["id"])
        )
    cleanup_orphan_files(con, [doc["file"]])


def ingest(
    con,
    matter,
    name,
    raw,
    *,
    folder_id=None,
    rel_path=None,
    source_mtime=None,
):
    base_name = Path(name.replace("\\", "/")).name
    ext = Path(base_name).suffix.lower()
    if ext not in MIME:
        raise HTTPException(
            415, "Formato non supportato. Usa PDF, DOCX, XLSX, CSV, TXT, MD, JPG o PNG."
        )
    if not raw or len(raw) > 32 * 1024 * 1024:
        raise HTTPException(413, "Carica un file non vuoto di massimo 32 MB.")
    display_name = base_name
    if rel_path and ("/" in rel_path or "\\" in rel_path):
        norm_rel = rel_path.replace("\\", "/")
        conflict = con.execute(
            "SELECT id, rel_path FROM docs WHERE matter=? AND name=? LIMIT 1",
            (matter, base_name),
        ).fetchone()
        if conflict and conflict["rel_path"] != norm_rel:
            display_name = norm_rel
    filename = hashlib.sha256(raw).hexdigest() + ext
    old = con.execute(
        "SELECT id FROM docs WHERE matter=? AND name=? AND file=?",
        (matter, display_name, filename),
    ).fetchone()
    if old:
        if folder_id is not None:
            con.execute(
                "UPDATE docs SET folder_id=?, rel_path=?, source_mtime=? WHERE id=?",
                (folder_id, rel_path, source_mtime, old[0]),
            )
        return old[0]
    try:
        pages, parts = extract(raw, ext)
    except Exception as e:
        raise HTTPException(422, f"Impossibile leggere {display_name}. {e}") from e
    target = data_dir() / "files" / filename
    if not target.exists():
        staging = target.with_suffix("." + uuid4().hex + ".tmp")
        staging.write_bytes(raw)
        staging.replace(target)
    doc = con.execute(
        "INSERT INTO docs(matter,name,file,mime,pages,folder_id,rel_path,source_mtime) VALUES(?,?,?,?,?,?,?,?)",
        (
            matter,
            display_name,
            filename,
            MIME[ext],
            pages,
            folder_id,
            rel_path,
            source_mtime,
        ),
    ).lastrowid
    for p, label, txt, rects, vis in parts:
        cid = con.execute(
            "INSERT INTO chunks(doc,page,label,text,rects,visual) VALUES(?,?,?,?,?,?)",
            (doc, p, label, txt, rects, vis),
        ).lastrowid
        con.execute("INSERT INTO search_index(rowid,text) VALUES(?,?)", (cid, txt))
    return doc


def _iter_folder_files(root: Path, recursive: bool):
    found = []
    if recursive:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(
                d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")
            )
            for fname in sorted(filenames):
                if fname.startswith(".") or fname.startswith("~$"):
                    continue
                p = Path(dirpath) / fname
                if p.suffix.lower() in MIME:
                    found.append(p)
                    if len(found) >= MAX_FOLDER_FILES:
                        return found
    else:
        for p in sorted(root.iterdir()):
            if not p.is_file():
                continue
            if p.name.startswith(".") or p.name.startswith("~$"):
                continue
            if p.suffix.lower() in MIME:
                found.append(p)
                if len(found) >= MAX_FOLDER_FILES:
                    return found
    return found


def sync_folder(con, folder_row) -> dict:
    folder_path = Path(folder_row["path"])
    if not folder_path.exists() or not folder_path.is_dir():
        raise HTTPException(
            404, f"Cartella non trovata o non accessibile: {folder_row['path']}"
        )
    files = _iter_folder_files(folder_path, bool(folder_row["recursive"]))
    existing = {
        r["rel_path"]: dict(r)
        for r in con.execute(
            "SELECT id, name, file, rel_path, source_mtime FROM docs WHERE folder_id=?",
            (folder_row["id"],),
        ).fetchall()
        if r["rel_path"]
    }
    seen = set()
    added = 0
    updated = 0
    unchanged = 0
    skipped = 0
    for p in files:
        rel = p.relative_to(folder_path).as_posix()
        seen.add(rel)
        try:
            stat = p.stat()
            if stat.st_size == 0 or stat.st_size > 32 * 1024 * 1024:
                skipped += 1
                continue
            mtime = stat.st_mtime
            prev = existing.get(rel)
            if (
                prev
                and prev["source_mtime"] is not None
                and abs(prev["source_mtime"] - mtime) < 0.01
            ):
                unchanged += 1
                continue
            raw = p.read_bytes()
            if prev:
                delete_doc(con, prev["id"])
                ingest(
                    con,
                    folder_row["matter"],
                    p.name,
                    raw,
                    folder_id=folder_row["id"],
                    rel_path=rel,
                    source_mtime=mtime,
                )
                updated += 1
            else:
                ingest(
                    con,
                    folder_row["matter"],
                    p.name,
                    raw,
                    folder_id=folder_row["id"],
                    rel_path=rel,
                    source_mtime=mtime,
                )
                added += 1
        except (OSError, HTTPException):
            skipped += 1

    removed = 0
    for rel, prev in existing.items():
        if rel not in seen:
            delete_doc(con, prev["id"])
            removed += 1

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    count = con.execute(
        "SELECT COUNT(*) FROM docs WHERE folder_id=?", (folder_row["id"],)
    ).fetchone()[0]
    con.execute(
        "UPDATE matter_folders SET last_sync=?, file_count=? WHERE id=?",
        (now, count, folder_row["id"]),
    )
    return {
        "added": added,
        "updated": updated,
        "removed": removed,
        "unchanged": unchanged,
        "skipped": skipped,
        "fileCount": count,
        "lastSync": now,
    }


def browse_directories(raw_path: str | None = None) -> dict:
    home = Path.home()
    shortcuts = [
        {"label": "Cartella progetto", "path": str(ROOT)},
        {"label": "Home", "path": str(home)},
    ]
    for sub, label in [("Desktop", "Desktop"), ("Documents", "Documenti")]:
        candidate = home / sub
        if candidate.is_dir():
            shortcuts.append({"label": label, "path": str(candidate)})

    if not raw_path or not raw_path.strip():
        entries = []
        if os.name == "nt":
            for letter in string.ascii_uppercase:
                drive = Path(f"{letter}:\\")
                if drive.exists():
                    entries.append(
                        {"name": f"{letter}:\\", "path": str(drive), "files": 0}
                    )
        else:
            entries.append({"name": "/", "path": "/", "files": 0})
        return {
            "current": "",
            "parent": "",
            "shortcuts": shortcuts,
            "entries": entries,
            "supportedFilesCount": 0,
        }

    target = Path(raw_path.strip()).expanduser()
    try:
        resolved = target.resolve()
    except OSError as e:
        raise HTTPException(400, f"Percorso non valido: {e}") from e
    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(404, f"Cartella non trovata: {raw_path}")

    entries = []
    supported_count = 0
    try:
        for item in sorted(resolved.iterdir(), key=lambda x: x.name.lower()):
            if item.name.startswith(".") or item.name in SKIP_DIRS:
                continue
            if item.is_dir():
                sub_count = 0
                try:
                    for sub in item.iterdir():
                        if sub.is_file() and sub.suffix.lower() in MIME:
                            sub_count += 1
                except OSError:
                    pass
                entries.append(
                    {"name": item.name, "path": str(item), "files": sub_count}
                )
            elif item.is_file() and item.suffix.lower() in MIME:
                supported_count += 1
    except OSError as e:
        raise HTTPException(403, f"Impossibile leggere la cartella: {e}") from e

    parent = ""
    if resolved.parent != resolved:
        parent = str(resolved.parent)
    return {
        "current": str(resolved),
        "parent": parent,
        "shortcuts": shortcuts,
        "entries": entries[:120],
        "supportedFilesCount": supported_count,
    }


def _add_formatted_runs(paragraph, text: str):
    parts = re.split(r"(\*\*[^*]+\*\*)", text)
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            run = paragraph.add_run(part[2:-2])
            run.bold = True
        else:
            paragraph.add_run(part)


def export_markdown_to_docx(title: str, markdown_text: str) -> bytes:
    doc = Document()
    normal_style = doc.styles["Normal"]
    normal_style.font.name = "Calibri"
    normal_style.font.size = Pt(11)

    if title.strip():
        doc.add_heading(title.strip(), level=0)

    lines = markdown_text.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("|") and i + 1 < len(lines) and "|" in lines[i + 1]:
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            parsed_rows = []
            for tl in table_lines:
                cells = [c.strip() for c in tl.strip("|").split("|")]
                if all(re.fullmatch(r":?-{2,}:?", c or "-") for c in cells):
                    continue
                parsed_rows.append(cells)
            if parsed_rows:
                ncols = max(len(r) for r in parsed_rows)
                table = doc.add_table(rows=len(parsed_rows), cols=ncols)
                table.style = "Table Grid"
                for r_idx, row_vals in enumerate(parsed_rows):
                    for c_idx in range(ncols):
                        val = row_vals[c_idx] if c_idx < len(row_vals) else ""
                        p = table.rows[r_idx].cells[c_idx].paragraphs[0]
                        if r_idx == 0:
                            run = p.add_run(val)
                            run.bold = True
                        else:
                            _add_formatted_runs(p, val)
            continue
        if stripped.startswith("### "):
            doc.add_heading(stripped[4:].strip(), level=3)
        elif stripped.startswith("## "):
            doc.add_heading(stripped[3:].strip(), level=2)
        elif stripped.startswith("# "):
            doc.add_heading(stripped[2:].strip(), level=1)
        elif stripped.startswith(("- ", "* ")):
            p = doc.add_paragraph(style="List Bullet")
            _add_formatted_runs(p, stripped[2:].strip())
        elif re.match(r"^\d+\.\s+", stripped):
            content = re.sub(r"^\d+\.\s+", "", stripped)
            p = doc.add_paragraph(style="List Number")
            _add_formatted_runs(p, content)
        elif stripped.startswith("> "):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Pt(18)
            run = p.add_run(stripped[2:].strip())
            run.italic = True
        else:
            p = doc.add_paragraph()
            _add_formatted_runs(p, stripped)
        i += 1

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
