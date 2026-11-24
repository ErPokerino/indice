import json
import math
import re
from array import array
from collections import defaultdict
from functools import lru_cache

from openpyxl.utils.cell import coordinate_to_tuple, range_boundaries

from . import gemini
from .store import key, rows

FIELDS = "c.id,c.doc,c.page,c.label,c.text,c.rects,c.visual,d.name,d.folder_id,d.rel_path"
JOIN = " FROM chunks c JOIN docs d ON c.doc=d.id "
STOP = {
    "nel",
    "nella",
    "nello",
    "nei",
    "delle",
    "degli",
    "della",
    "dello",
    "alle",
    "alla",
    "dai",
    "dal",
    "quale",
    "quali",
    "sono",
    "come",
    "cosa",
    "anche",
    "cerca",
    "fascicolo",
    "pratica",
    "archivio",
    "contratto",
    "riporta",
    "dimmi",
    "puoi",
    "posso",
    "devo",
    "cliente",
    "aggiornato",
    "aggiornati",
    "una",
    "uno",
    "che",
    "del",
    "per",
    "con",
    "gli",
    "fra",
    "sul",
    "documenti",
    "riassunto",
    "riassumi",
    "sintesi",
    "tabella",
    "grafico",
    "mostra",
    "crea",
}


def words(q):
    return [
        w
        for w in re.findall(r"[^\W_]+", q.lower())
        if (len(w) > 2 or w.isdigit()) and w not in STOP
    ]


def public(r, quote=None):
    return {
        "id": r["id"],
        "doc": r["doc"],
        "page": r["page"],
        "label": r["label"],
        "name": r["name"],
        "quote": r["text"] if quote is None else quote,
        "rects": json.loads(r["rects"]),
        "visual": bool(r["visual"]),
    }


def active_doc_ids(con, matter: int, doc_filter: str | None = None) -> set[int]:
    sql = """
        SELECT d.id, d.name, COALESCE(d.rel_path, '') AS rel_path,
               COALESCE(f.label, '') AS folder_label
        FROM docs d
        LEFT JOIN matter_folders f ON f.id = d.folder_id
        WHERE d.matter = ? AND (d.folder_id IS NULL OR f.enabled = 1)
    """
    docs = con.execute(sql, (matter,)).fetchall()
    if not doc_filter or not doc_filter.strip():
        return {r["id"] for r in docs}
    needle = doc_filter.strip().casefold()
    matched = {
        r["id"]
        for r in docs
        if needle in r["name"].casefold()
        or needle in r["rel_path"].casefold()
        or needle in r["folder_label"].casefold()
    }
    return matched if matched else {r["id"] for r in docs}


def selected_rows(con, matter, ids):
    if not ids:
        return []
    marks = ",".join("?" for _ in ids)
    return rows(
        con,
        "SELECT "
        + FIELDS
        + JOIN
        + f"WHERE d.matter=? AND d.id IN ({marks}) ORDER BY c.id",
        [matter, *ids],
    )


@lru_cache(maxsize=128)
def query_vector(q):
    return gemini.embed([q], "query")[0]


def _load_corpus(con, matter: int, allowed_ids: set[int]):
    if not allowed_ids:
        return []
    marks = ",".join("?" for _ in allowed_ids)
    return rows(
        con,
        "SELECT "
        + FIELDS
        + ",c.vector"
        + JOIN
        + f"WHERE d.matter=? AND d.id IN ({marks}) AND c.visual=0 ORDER BY c.id",
        [matter, *sorted(allowed_ids)],
    )


def search_exact_clause(con, matter: int, q: str, doc_filter: str | None = None, limit=8):
    allowed = active_doc_ids(con, matter, doc_filter)
    corpus = _load_corpus(con, matter, allowed)
    if not corpus:
        return []
    clause = re.search(r"(?:art(?:icolo|\.)?)\s*(\d+[a-z]?)\b", q, re.IGNORECASE)
    quoted = re.findall(r'[«“"]([^»”"]{2,})[»”"]', q)
    if not clause and not quoted:
        return []
    ranks = defaultdict(float)
    for i, r in enumerate(corpus):
        if any(s.casefold() in " ".join(r["text"].split()).casefold() for s in quoted):
            ranks[r["id"]] += 3.0
        if clause and re.search(
            r"\bart(?:icolo|\.)?\s*" + re.escape(clause[1]) + r"\b",
            r["text"],
            re.IGNORECASE,
        ):
            ranks[r["id"]] += 2.0
            for s in corpus[i + 1 : i + 5]:
                if (
                    s["doc"] != r["doc"]
                    or s["page"] != r["page"]
                    or re.match(r"Art\.", s["text"], re.IGNORECASE)
                ):
                    break
                ranks[s["id"]] += 1.0
    return sorted(
        (r for r in corpus if r["id"] in ranks),
        key=lambda r: (-ranks[r["id"]], r["id"]),
    )[:limit]


def search_cell_range(con, matter: int, q: str, doc_filter: str | None = None, limit=12):
    allowed = active_doc_ids(con, matter, doc_filter)
    corpus = _load_corpus(con, matter, allowed)
    if not corpus:
        return []
    address = re.search(
        r"(?:(?:'([^']+)'|([\w.-]+))!)?\b([A-Za-z]{1,3}[1-9]\d{0,6}(?::[A-Za-z]{1,3}[1-9]\d{0,6})?)\b",
        q,
    )
    if not address:
        return []
    sheet = (address[1] or address[2] or "").casefold()
    left, top, right, bottom = range_boundaries(address[3].upper())
    ranks = defaultdict(float)
    for r in corpus:
        sheet_name, _, cell = r["label"].rpartition("!")
        if (not sheet or sheet == sheet_name.casefold()) and re.fullmatch(
            r"[A-Z]{1,3}[1-9]\d*", cell
        ):
            row, col = coordinate_to_tuple(cell)
            if top <= row <= bottom and left <= col <= right:
                ranks[r["id"]] += 3.0
    return sorted(
        (r for r in corpus if r["id"] in ranks),
        key=lambda r: (-ranks[r["id"]], r["id"]),
    )[:limit]


def search_hybrid(
    con, matter: int, q: str, semantic: bool = True, doc_filter: str | None = None, limit=8
):
    allowed = active_doc_ids(con, matter, doc_filter)
    corpus = _load_corpus(con, matter, allowed)
    if not corpus:
        return [], "Archivio vuoto"
    tokens = words(q)
    if re.search(
        r"interromp|sciogli|reced|disdett|recesso|preavviso", q, re.IGNORECASE
    ):
        tokens.extend(["recesso", "preavviso", "recedere"])
    ranks = defaultdict(float)
    if tokens:
        expression = " OR ".join('"' + w + '"' for w in dict.fromkeys(tokens))
        hits = con.execute(
            "SELECT c.id FROM search_index JOIN chunks c ON c.id=search_index.rowid "
            "JOIN docs d ON d.id=c.doc WHERE search_index MATCH ? AND d.matter=? "
            "ORDER BY bm25(search_index) LIMIT 32",
            (expression, matter),
        )
        for i, (cid,) in enumerate(hits):
            if any(r["id"] == cid for r in corpus):
                ranks[cid] += 1 / (24 + i)
    method = "Parole chiave"
    if semantic and key():
        missing = [r for r in corpus if not r["vector"]]
        for offset in range(0, len(missing), 32):
            batch = missing[offset : offset + 32]
            vectors = gemini.embed(
                [r["name"] + " · " + r["label"] + "\n" + r["text"] for r in batch],
                "document",
            )
            for r, v in zip(batch, vectors, strict=True):
                r["vector"] = array("f", v).tobytes()
            con.executemany(
                "UPDATE chunks SET vector=? WHERE id=?",
                [(r["vector"], r["id"]) for r in batch],
            )
            con.commit()
        v = query_vector(q)

        def similarity(r):
            w = array("f", r["vector"])
            return sum(a * b for a, b in zip(v, w)) / (
                max(1e-9, math.sqrt(sum(a * a for a in v) * sum(b * b for b in w)))
            )

        semantic_hits = sorted(((similarity(r), r["id"]) for r in corpus), reverse=True)
        for i, (score, cid) in enumerate(semantic_hits[:24]):
            if score > 0.22:
                ranks[cid] += 1 / (24 + i)
        method = "Ricerca ibrida · testo e significato"
    result = sorted(
        (r for r in corpus if r["id"] in ranks),
        key=lambda r: (-ranks[r["id"]], r["id"]),
    )[:limit]
    return result, method


def summarize_document_outline(
    con, matter: int, doc_filter: str | None = None, limit=8
):
    allowed = active_doc_ids(con, matter, doc_filter)
    corpus = _load_corpus(con, matter, allowed)
    if not corpus:
        return []
    by_doc = defaultdict(list)
    for r in corpus:
        by_doc[r["doc"]].append(r)
    selected = []
    seen = set()
    structural_re = re.compile(
        r"^(?:art(?:icolo|\.)?|sezione|premesse|oggetto|titolo|capo|clausola)\b",
        re.IGNORECASE,
    )
    for doc_chunks in by_doc.values():
        doc_picks = []
        include_next = 0
        for idx, r in enumerate(doc_chunks):
            txt = r["text"].strip()
            if structural_re.match(txt):
                doc_picks.append(r)
                include_next = 2
            elif idx < 2 or include_next > 0 or idx == len(doc_chunks) - 1:
                doc_picks.append(r)
                if include_next > 0:
                    include_next -= 1
        if not doc_picks:
            doc_picks = doc_chunks[:4]
        for r in doc_picks:
            if r["id"] not in seen:
                seen.add(r["id"])
                selected.append(r)
                if len(selected) >= limit:
                    return selected
    return selected[:limit]


def search(con, matter, q, semantic, limit=8):
    allowed = active_doc_ids(con, matter)
    corpus = _load_corpus(con, matter, allowed)
    if not corpus:
        return [], "Archivio vuoto"
    clause = re.search(r"(?:art(?:icolo|\.)?)\s*(\d+[a-z]?)\b", q, re.IGNORECASE)
    quoted = re.findall(r'[«“"]([^»”"]{2,})[»”"]', q)
    address = re.search(
        r"(?:(?:'([^']+)'|([\w.-]+))!)?\b([A-Za-z]{1,3}[1-9]\d{0,6}(?::[A-Za-z]{1,3}[1-9]\d{0,6})?)\b",
        q,
    )
    exact = bool(clause or quoted or address)
    if exact:
        hits = []
        if address:
            hits.extend(search_cell_range(con, matter, q, limit=limit))
        if clause or quoted:
            hits.extend(search_exact_clause(con, matter, q, limit=limit))
        dedup = []
        seen = set()
        for r in hits:
            if r["id"] not in seen:
                seen.add(r["id"])
                dedup.append(r)
        return dedup[:limit], "Ricerca puntuale"
    return search_hybrid(con, matter, q, semantic=semantic, limit=limit)
