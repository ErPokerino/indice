import re
from functools import lru_cache

from fastapi import HTTPException

from . import gemini
from .search import (
    search_cell_range,
    search_exact_clause,
    search_hybrid,
    selected_rows,
    summarize_document_outline,
)
from .store import dump, key

AGENT_TOOLS = [
    {
        "id": "exact_clause",
        "name": "Estrattore Clausole & Articoli",
        "category": "Retrieval puntuale",
        "desc": "Individua articoli numerati (es. Art. 8), citazioni letterali tra virgolette e i commi adiacenti.",
    },
    {
        "id": "cell_range",
        "name": "Lettore Celle & Fogli",
        "category": "Retrieval tabellare",
        "desc": "Risolve indirizzi e intervalli Excel/CSV (es. Prezzi!A2:B10) preservando formule e valori.",
    },
    {
        "id": "semantic_concept",
        "name": "Ricerca Ibrida FTS5 + Embedding",
        "category": "Retrieval concettuale",
        "desc": "Fonde BM25 SQLite e similarità semantica Gemini Embedding con Reciprocal Rank Fusion.",
    },
    {
        "id": "document_summary",
        "name": "Sintetizzatore Strutturale",
        "category": "Retrieval olistico",
        "desc": "Estrae epigrafe, articoli chiave e struttura complessiva quando occorre un riassunto d'insieme.",
    },
    {
        "id": "full_document",
        "name": "Lettore Integrale / Multimodale",
        "category": "Contesto pieno",
        "desc": "Invia PDF e immagini integralmente a Gemini o carica tutti i passaggi di un documento.",
    },
    {
        "id": "template_compiler",
        "name": "Compilatore Modelli Legali",
        "category": "Drafting",
        "desc": "Compila modelli di documenti standard e personalizzati integrando esempi allegati e indicazioni in chat.",
    },
]

AGENT_SKILLS = [
    {
        "id": "citation_grounding",
        "name": "Ancoraggio & Verifica Citazioni",
        "trigger": "Sempre attiva",
        "desc": "Impone marcatori [sID], verifica letterale delle quote contro il catalogo e rigetto delle allucinazioni.",
    },
    {
        "id": "clause_comparison",
        "name": "Confronto Versioni & Prevalenza",
        "trigger": "Più fonti / Addendum / Modifiche",
        "desc": "Distingue contratto originario, addendum e decorrenze temporali segnalando quale clausola prevale.",
    },
    {
        "id": "legal_drafting",
        "name": "Redazione Guidata da Modello ed Esempi",
        "trigger": "Modello di documento attivo",
        "desc": "Trae spunto stilistico dagli esempi allegati, compila i campi dalle indicazioni in chat e marca solo ciò che manca.",
    },
    {
        "id": "tabular_analytics",
        "name": "Sintesi Tabellare, Grafici & Timeline",
        "trigger": "Output tabella/grafico o confronti quantitativi/temporali",
        "desc": "Produce tabelle strutturate esportabili, grafici comparativi e timeline delle scadenze contrattuali.",
    },
]

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "archive": {"type": "boolean"},
        "query": {"type": "string"},
        "full": {"type": "string"},
        "template": {"type": "string"},
        "output_mode": {
            "type": "string",
            "enum": ["auto", "table", "chart", "document"],
        },
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "strategy": {
                        "type": "string",
                        "enum": [
                            "exact_clause",
                            "cell_range",
                            "semantic_concept",
                            "document_summary",
                        ],
                    },
                    "query": {"type": "string"},
                    "doc_filter": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["strategy", "query", "reason"],
            },
        },
    },
    "required": ["archive", "query", "full", "template"],
}


def blueprint():
    return {"tools": AGENT_TOOLS, "skills": AGENT_SKILLS}


@lru_cache(maxsize=128)
def interpret(model, q, doc_names, template_names, previous_question):
    instructions = (
        "Agisci come orchestratore legale italiano multi-retrieval. "
        "Decidi quali strumenti e strategie attivare simultaneamente per la richiesta. "
        "archive=true solo quando si chiede di cercare fuori dagli allegati, nel fascicolo, "
        "tra tutti i documenti, nelle cartelle, o si nomina un documento non allegato. "
        "Per una domanda generica sui soli allegati resta con archive=false. "
        "query è la query principale. full è il nome esatto di un file se richiesto integralmente, altrimenti ''. "
        "template è il nome esatto di un modello di documento da applicare se richiesto, altrimenti ''. "
        "In tasks scomponi richieste complesse in più sotto-ricerche parallele scegliendo tra: "
        "exact_clause (articoli o frasi esatte), cell_range (celle Excel/CSV), "
        "document_summary (riassunto/panoramica di un documento), semantic_concept (ricerca per concetto). "
        "Imposta output_mode su table, chart, document o auto."
    )
    body = {
        "systemInstruction": {"parts": [{"text": instructions}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": dump(
                            {
                                "richiesta": q,
                                "domanda_precedente": previous_question,
                                "documenti": doc_names,
                                "modelli_documento": template_names,
                            }
                        )
                    }
                ],
            }
        ],
    }
    return gemini.generate(model, "low", body, PLAN_SCHEMA)


def _detect_doc_mentions(q: str, doclist: list[dict]) -> list[dict]:
    q_cf = q.casefold()
    found = []
    for d in doclist:
        name = d["name"]
        stem = name.rsplit(".", 1)[0]
        if name.casefold() in q_cf or (len(stem) >= 4 and re.search(r"\b" + re.escape(stem.casefold()) + r"\b", q_cf)):
            found.append(d)
    return found


def _decompose_tasks(q: str, doclist: list[dict], base_query: str) -> list[dict]:
    tasks = []
    mentions = _detect_doc_mentions(q, doclist)

    def guess_filter(pattern: str) -> str:
        m = re.search(pattern, q, re.IGNORECASE)
        if m:
            span = m.group(0).casefold()
            for d in mentions:
                stem = d["name"].rsplit(".", 1)[0].casefold()
                if d["name"].casefold() in span or stem in span:
                    return d["name"]
        return ""

    clause_m = re.search(r"(?:art(?:icolo|\.)?)\s*\d+[a-z]?\b", q, re.IGNORECASE)
    quoted_m = re.findall(r'[«“"]([^»”"]{2,})[»”"]', q)
    if clause_m or quoted_m:
        clause_query = clause_m.group(0) if clause_m else f'"{quoted_m[0]}"'
        f = guess_filter(r"(?:art(?:icolo|\.)?\s*\d+[a-z]?[^.,;]{0,45})")
        tasks.append(
            {
                "strategy": "exact_clause",
                "query": clause_query,
                "doc_filter": f,
                "reason": "Recupero puntuale di articolo o citazione letterale",
            }
        )

    addr_m = re.search(
        r"(?:(?:'[^']+'|[\w.-]+)!)?\b[A-Za-z]{1,3}[1-9]\d{0,6}(?::[A-Za-z]{1,3}[1-9]\d{0,6})?\b",
        q,
    )
    if addr_m:
        tasks.append(
            {
                "strategy": "cell_range",
                "query": addr_m.group(0),
                "doc_filter": "",
                "reason": "Lettura diretta celle o intervallo di foglio",
            }
        )

    summary_m = re.search(
        r"(?:riassun\w*|riassum\w*|sintesi|panoramic\w*|struttura\w*|sommari\w*)",
        q,
        re.IGNORECASE,
    )
    if summary_m:
        f = guess_filter(
            r"(?:riassun\w*|riassum\w*|sintesi|panoramic\w*)[^.,;]{0,50}"
        )
        if not f and len(mentions) == 1:
            f = mentions[0]["name"]
        elif not f and len(mentions) > 1:
            for d in mentions:
                if d["name"] != (tasks[0]["doc_filter"] if tasks else ""):
                    f = d["name"]
                    break
        tasks.append(
            {
                "strategy": "document_summary",
                "query": base_query or q,
                "doc_filter": f,
                "reason": "Estrazione struttura e sintesi del documento",
            }
        )

    needs_semantic = (
        not tasks
        or bool(
            re.search(
                r"\b(?:concett\w*|rischi\w*|confront\w*|differenz\w*|modific\w*|penal\w*|condizion\w*|spieg\w*|perch[eé]|qual\s+[eè])\b",
                q,
                re.IGNORECASE,
            )
        )
        or len(q.split()) >= 9
    )
    if needs_semantic:
        tasks.append(
            {
                "strategy": "semantic_concept",
                "query": base_query or q,
                "doc_filter": "",
                "reason": "Ricerca ibrida (testo BM25 + semantica) nel fascicolo",
            }
        )

    dedup = []
    seen = set()
    for t in tasks:
        k = (t["strategy"], t["query"].casefold(), t["doc_filter"].casefold())
        if k not in seen:
            seen.add(k)
            dedup.append(t)
    return dedup


def _infer_output_mode(q: str, form_mode: str, tpl) -> str:
    if form_mode and form_mode != "auto":
        return form_mode
    if re.search(
        r"\b(?:grafic\w*|istogramm\w*|torta|donut|timeline|cronologi\w*|linea\s+temporale)\b",
        q,
        re.IGNORECASE,
    ):
        return "chart"
    if re.search(
        r"\b(?:tabell\w*|matrice|riepilogo\s+comparativo|griglia|schema\s+tabellare)\b",
        q,
        re.IGNORECASE,
    ):
        return "table"
    if tpl:
        return "document"
    return "auto"


def plan_turn(
    model: str,
    q: str,
    doclist: list[dict],
    templates: list[dict],
    history: list[dict],
    form,
    route_live: bool,
):
    scope = bool(getattr(form, "archive", False)) or bool(
        re.search(
            r"(?:cerc\w*|verific\w*|controll\w*|consult\w*|rintracci\w*|trova|guard\w*|estrai\w*).{0,65}(?:fascicolo|archivio|pratica|cartell\w*|tutti i (?:file|documenti))",
            q,
            re.IGNORECASE,
        )
    )
    tpl = next(
        (
            t
            for t in templates
            if getattr(form, "template", None) == t["id"]
            or (q and t["name"].casefold() in q.casefold())
        ),
        None,
    )
    named = next(
        (
            d
            for d in doclist
            if d["name"].casefold() in q.casefold()
            and re.search(r"inter[oa]|integral|apri|complet", q, re.IGNORECASE)
        ),
        None,
    )
    query = q
    llm_tasks = []
    if q and route_live and key():
        route = interpret(
            model,
            q,
            tuple(d["name"] for d in doclist),
            tuple(t["name"] for t in templates),
            history[-1]["request"] if history else "",
        )
        scope = scope or bool(route.get("archive"))
        query = route.get("query") or q
        named = named or next(
            (d for d in doclist if d["name"] == route.get("full")), None
        )
        tpl = tpl or next(
            (t for t in templates if t["name"] == route.get("template")), None
        )
        for raw_t in route.get("tasks") or []:
            if isinstance(raw_t, dict) and raw_t.get("strategy"):
                llm_tasks.append(
                    {
                        "strategy": raw_t["strategy"],
                        "query": raw_t.get("query") or query,
                        "doc_filter": raw_t.get("doc_filter") or "",
                        "reason": raw_t.get("reason") or "Pianificato dall'orchestratore",
                    }
                )
        if getattr(form, "output_mode", "auto") == "auto" and route.get("output_mode"):
            form_mode = route["output_mode"]
        else:
            form_mode = getattr(form, "output_mode", "auto")
    else:
        form_mode = getattr(form, "output_mode", "auto")

    det_tasks = _decompose_tasks(q, doclist, query) if q else []
    merged_tasks = []
    seen = set()
    for t in llm_tasks + det_tasks:
        key_t = (t["strategy"], t["query"].casefold(), t.get("doc_filter", "").casefold())
        if key_t not in seen:
            seen.add(key_t)
            merged_tasks.append(t)

    if not scope and any(
        t["strategy"] in ("exact_clause", "cell_range", "document_summary")
        for t in merged_tasks
    ) and len(merged_tasks) >= 2:
        # Multi-source composite request naturally spans the dossier unless user strictly forbids search
        pass

    output_mode = _infer_output_mode(q, form_mode, tpl)
    skills = ["citation_grounding"]
    if scope or len(doclist) > 1 or re.search(r"confront|addendum|modific|version", q, re.I):
        skills.append("clause_comparison")
    if tpl:
        skills.append("legal_drafting")
    if output_mode in ("table", "chart") or re.search(
        r"tabell|grafic|timeline|confront|prezz|import|scadenz", q, re.I
    ):
        skills.append("tabular_analytics")

    return {
        "scope": scope,
        "query": query,
        "named": named,
        "template": tpl,
        "output_mode": output_mode,
        "tasks": merged_tasks[:5],
        "skills": list(dict.fromkeys(skills)),
    }


def execute_plan(con, matter: int, plan: dict, selected: list[int], cfg: dict):
    full = list(selected)
    trace = []
    plan_steps = []
    named = plan["named"]
    scope = plan["scope"]
    tpl = plan["template"]
    q = plan["query"]

    if named and "open" in cfg["tools"]:
        if named["id"] not in full:
            full.append(named["id"])
        trace.append("Documento intero · " + named["name"])
        plan_steps.append(
            {
                "strategy": "full_document",
                "query": named["name"],
                "docFilter": named["name"],
                "reason": "Apertura integrale richiesta dall'utente",
                "hits": 1,
            }
        )
    if scope and "search" not in cfg["tools"] and q:
        raise HTTPException(409, "Ricerca nel fascicolo disattivata in Configurazione.")
    if named and "open" not in cfg["tools"]:
        raise HTTPException(
            409, "Lo strumento per aprire un documento intero è disattivato."
        )
    if tpl and "template" not in cfg["tools"]:
        raise HTTPException(
            409, "La generazione da modelli di documenti è disattivata."
        )
    if scope and "read" not in cfg["tools"]:
        raise HTTPException(
            409, "Attiva la lettura dei passaggi per usare i risultati in chat."
        )

    retained = selected_rows(con, matter, full)
    found = []
    seen_ids = set()

    if scope and "search" in cfg["tools"] and q:
        methods_used = []
        for task in plan["tasks"]:
            strat = task["strategy"]
            tq = task["query"]
            df = task.get("doc_filter") or None
            hits = []
            label = strat
            if strat == "exact_clause":
                hits = search_exact_clause(con, matter, tq, doc_filter=df, limit=6)
                label = "Ricerca puntuale clausola"
            elif strat == "cell_range":
                hits = search_cell_range(con, matter, tq, doc_filter=df, limit=8)
                label = "Lettura celle"
            elif strat == "document_summary":
                hits = summarize_document_outline(con, matter, doc_filter=df, limit=6)
                label = "Sintesi strutturale"
            else:
                hits, label = search_hybrid(
                    con, matter, tq, semantic=cfg["semantic"], doc_filter=df, limit=6
                )
            methods_used.append(label)
            added_here = 0
            for r in hits:
                if r["id"] not in seen_ids:
                    seen_ids.add(r["id"])
                    found.append(r)
                    added_here += 1
            plan_steps.append(
                {
                    "strategy": strat,
                    "query": tq,
                    "docFilter": df or "",
                    "reason": task.get("reason", ""),
                    "hits": len(hits),
                }
            )
        summary_method = " + ".join(dict.fromkeys(methods_used)) or "Ricerca"
        trace.append(f"{summary_method} · {len(found)} passaggi")

    if found:
        trace.append("Lettura dei passaggi recuperati")
    if tpl:
        trace.append("Modello · " + tpl["name"] + f" · v{tpl['version']}")
    if plan["output_mode"] in ("table", "chart"):
        trace.append(
            "Resa · " + ("Tabella" if plan["output_mode"] == "table" else "Grafico/Timeline")
        )

    return {
        "full": full,
        "retained": retained,
        "found": found,
        "trace": trace,
        "plan_steps": plan_steps,
    }
