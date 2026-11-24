import io
import json

import pymupdf as fitz
from openpyxl import Workbook

from .documents import ingest
from .store import DEFAULT_PROMPT, TOOLS, db, dump, new_session, setup

OLD = "Il termine di preavviso è fissato in 30 giorni."
NEW = "Il termine di preavviso è fissato in 60 giorni."

STANDARD_LEGAL_TEMPLATES = [
    {
        "name": "Nota al cliente",
        "category": "Corrispondenza",
        "purpose": "Comunicare un esito documentato al cliente in modo chiaro e operativo.",
        "tone": "Professionale chiaro e rassicurante",
        "audience": "Cliente / Direzione aziendale",
        "jurisdiction": "Diritto italiano",
        "output_format": "Nota informativa strutturata",
        "sections": "Oggetto\nSintesi esecutiva\nAnalisi delle fonti\nRischi e scadenze\nProssimi passi",
        "fields": "Destinatario\nOggetto della richiesta\nRiferimento pratica",
        "clause_rules": "Richiamare numero di articolo/pagina delle fonti\nEvidenziare eventuali termini perentori",
        "instructions": "Usa un tono chiaro. Cita le clausole e chiedi eventuali dati mancanti prima dell'invio definitivo.",
        "custom_attrs": [
            {"key": "Lunghezza consigliata", "value": "1-2 pagine"},
            {"key": "Livello citazioni", "value": "Puntuale su clausola e pagina"},
        ],
        "example": {
            "name": "Esempio_Nota_Cliente_Standard.txt",
            "notes": "Modello stilistico per struttura, intestazione e chiarezza espositiva verso il cliente.",
            "text": (
                "Gentile [Cliente],\n\n"
                "Oggetto: Verifica dei termini contrattuali applicabili – Pratica [Riferimento]\n\n"
                "1. Sintesi esecutiva\n"
                "All'esito dell'esame documentale, il termine applicabile risulta modificato dall'atto integrativo successivo.\n\n"
                "2. Analisi delle fonti\n"
                "- Contratto originario (Art. X, pag. Y): prevedeva la disciplina iniziale.\n"
                "- Atto modificativo (Art. Z, pag. W): ha sostituito espressamente la previsione precedente.\n\n"
                "3. Prossimi passi\n"
                "Restiamo in attesa di conferma sui dati operativi residui per procedere con l'invio formale."
            ),
        },
    },
    {
        "name": "Parere legale motivato (Pro Veritate)",
        "category": "Pareri",
        "purpose": "Esaminare un quesito giuridico complesso con ricostruzione dei fatti, norme, rischi e raccomandazioni.",
        "tone": "Tecnico-giuridico rigoroso e imparziale",
        "audience": "Consiglio di amministrazione / General Counsel",
        "jurisdiction": "Diritto civile e commerciale italiano",
        "output_format": "Parere pro veritate con matrice rischi",
        "sections": "Quesito sottoposto\nFatto e documentazione esaminata\nQuadro normativo e giurisprudenziale\nValutazione giuridica e profili di rischio\nConclusioni e raccomandazioni operative",
        "fields": "Cliente / Richiedente\nOggetto del quesito\nDocumenti esaminati\nScadenza o urgenza",
        "clause_rules": "Distinguere rigorosamente fatti provati da ipotesi interpretative\nIncludere tabella sintetica dei rischi (Alto/Medio/Basso)",
        "instructions": "Redigi il parere con rigore argomentativo, richiamando espressamente gli articoli contrattuali e segnalando lacune documentali.",
        "custom_attrs": [
            {"key": "Grado di prudenza", "value": "Conservativo (risk-first)"},
            {"key": "Tabella finale", "value": "Matrice rischi e probabilità"},
        ],
        "example": None,
    },
    {
        "name": "Lettera di diffida e messa in mora",
        "category": "Contenzioso",
        "purpose": "Contestare formalmente un inadempimento contrattuale e fissare un termine perentorio ex artt. 1219 e 1454 c.c.",
        "tone": "Formale, fermo e giuridicamente inequivoco",
        "audience": "Controparte contrattuale (via PEC / Raccomandata A/R)",
        "jurisdiction": "Codice Civile italiano (artt. 1219, 1453, 1454 c.c.)",
        "output_format": "Diffida formale pronta per invio PEC",
        "sections": "Intestazione e modalità di trasmissione\nPremesse e titolo contrattuale\nContestazione puntuale dell'inadempimento\nIntimazione ad adempiere e termine\nAvvertimento di risoluzione e riserva danni\nSottoscrizione e procura",
        "fields": "Mittente (Parte adempiente)\nDestinatario / PEC\nContratto e data stipula\nInadempimento contestato\nTermine per adempiere (es. 15 giorni)",
        "clause_rules": "Citare articolo violato e data di scadenza disattesa\nInserire espresso avvertimento risolutorio ex art. 1454 c.c. se richiesto\nRiservare ogni azione per danni, interessi e spese",
        "instructions": "Usa un registro formale da atto stragiudiziale. Verifica sempre che importo, data contratto e termine assegnato siano presenti o indicati come da completare.",
        "custom_attrs": [
            {"key": "Canale invio", "value": "PEC con ricevuta completa"},
            {"key": "Termine tipico", "value": "15 giorni dal ricevimento"},
        ],
        "example": {
            "name": "Esempio_Diffida_Art1454.txt",
            "notes": "Esempio di formulazione dell'intimazione formale e della riserva dei diritti.",
            "text": (
                "Trasmessa a mezzo PEC\n\n"
                "Spett.le [Controparte]\n"
                "c.a. Legale Rappresentante\n\n"
                "Oggetto: Diffida ad adempiere e costituzione in mora ex artt. 1219 e 1454 c.c.\n\n"
                "In nome e per conto della nostra assistita [Mittente], Vi contestiamo formalmente il mancato adempimento...\n"
                "Vi intimiamo pertanto di provvedere entro e non oltre il termine perentorio di [Termine] giorni dal ricevimento della presente, "
                "con espresso avvertimento che, in difetto, il contratto si intenderà risolto di diritto, con ogni riserva di risarcimento dei danni."
            ),
        },
    },
    {
        "name": "Accordo di riservatezza (NDA)",
        "category": "Contrattualistica",
        "purpose": "Disciplinare la protezione delle informazioni riservate scambiate in fase di trattativa o collaborazione.",
        "tone": "Contrattuale preciso ed equilibrato",
        "audience": "Parti contraenti (B2B)",
        "jurisdiction": "Diritto italiano e Codice Proprietà Industriale",
        "output_format": "Contratto articolato per clausole",
        "sections": "Parti e Premesse\nArt. 1 · Definizioni e Informazioni Riservate\nArt. 2 · Obblighi di riservatezza e custodia\nArt. 3 · Esclusioni\nArt. 4 · Durata e restituzione dei materiali\nArt. 5 · Penale e rimedi\nArt. 6 · Legge applicabile e Foro competente",
        "fields": "Parte divulgante\nParte ricevente\nOggetto della trattativa\nDurata vincolo (anni)\nForo competente",
        "clause_rules": "Specificare se unilaterale o bilaterale\nPrevedere esclusioni standard (dominio pubblico, obbligo di legge)",
        "instructions": "Redigi clausole numerate chiare, coerenti nelle definizioni e adattabili a NDA unilaterale o reciproco.",
        "custom_attrs": [
            {"key": "Natura", "value": "Bilaterale (adattabile a unilaterale)"},
            {"key": "Sopravvivenza obblighi", "value": "3-5 anni post cessazione"},
        ],
        "example": None,
    },
    {
        "name": "Addendum / Atto modificativo contrattuale",
        "category": "Contrattualistica",
        "purpose": "Integrare o sostituire specifiche clausole di un contratto vigente mantenendo ferme le restanti pattuizioni.",
        "tone": "Contrattuale tecnico e coerente con il contratto base",
        "audience": "Parti firmatarie del contratto originario",
        "jurisdiction": "Diritto italiano",
        "output_format": "Atto integrativo con clausole sostitutive",
        "sections": "Epigrafe e Parti\nPremesse e richiamo al Contratto originario\nArt. 1 · Oggetto della modifica\nArt. 2 · Testo sostitutivo delle clausole modificate\nArt. 3 · Conferma delle restanti disposizioni\nArt. 4 · Decorrenza e sottoscrizione",
        "fields": "Parti contraenti\nData e titolo contratto originario\nClausole oggetto di modifica\nData di decorrenza",
        "clause_rules": "Indicare con esattezza il testo previgente abrogato e il nuovo testo sostitutivo\nInserire clausola di salvezza per tutte le altre pattuizioni",
        "instructions": "Mantieni coerenza terminologica con il contratto originario esaminato nella pratica.",
        "custom_attrs": [
            {"key": "Regola conflitto", "value": "Prevalenza dell'Addendum in caso di contrasto"},
        ],
        "example": None,
    },
    {
        "name": "Scheda di Due Diligence / Red Flag Report",
        "category": "Compliance",
        "purpose": "Sintetizzare rischi, clausole critiche, scadenze, penali e anomalie di un fascicolo documentale.",
        "tone": "Analitico, sintetico ed orientato al decision-maker",
        "audience": "Partner / Team M&A / Compliance Officer",
        "jurisdiction": "Diritto italiano ed europeo",
        "output_format": "Report tabellare con indicatori di rischio",
        "sections": "Scheda anagrafica del fascicolo\nSommario esecutivo delle criticità\nTabella clausole critiche e red flag\nDisallineamenti tra documenti e allegati\nPiano di mitigazione consigliato",
        "fields": "Nome operazione / pratica\nDocumenti analizzati\nFocus di verifica (es. recesso, penali, prezzi)",
        "clause_rules": "Classificare ogni rilievo per gravità (Alto, Medio, Basso)\nProporre una tabella strutturata riepilogativa e una timeline se presenti date",
        "instructions": "Privilegia tabelle comparative chiare e cita sempre la fonte precisa per ciascuna criticità rilevata.",
        "custom_attrs": [
            {"key": "Scala rischio", "value": "Alto / Medio / Basso"},
            {"key": "Output visivo", "value": "Tabella + Timeline scadenze"},
        ],
        "example": None,
    },
]


def pdf(title, chapters):
    document = fitz.open()
    for n, (article, paragraphs) in enumerate(chapters, 1):
        page = document.new_page(width=400, height=505)
        ink = (0.105, 0.125, 0.16)
        page.insert_text(
            (34, 40),
            "ORIONE   /   UFFICIO CONTRATTI",
            fontname="hebo",
            fontsize=8,
            color=(0.34, 0.38, 0.47),
        )
        page.insert_textbox(
            fitz.Rect(34, 54, 367, 117),
            title,
            fontname="tibo",
            fontsize=22,
            lineheight=1.12,
            color=ink,
        )
        page.draw_line((34, 120), (366, 120), color=(0.75, 0.77, 0.80), width=0.7)
        y = 146
        for text, font, size in [(paragraphs[0], "tiro", 13), (article, "tibo", 16)] + [
            (s, "tiro", 13) for s in paragraphs[1:]
        ]:
            remaining = page.insert_textbox(
                fitz.Rect(34, y, 365, 470),
                text,
                fontname=font,
                fontsize=size,
                color=ink,
                lineheight=1.32,
            )
            y = 470 - remaining + 18
        page.draw_line((34, 466), (366, 466), color=(0.84, 0.85, 0.87), width=0.6)
        page.insert_text(
            (34, 483),
            "FORNITURA ORIONE",
            fontname="helv",
            fontsize=8,
            color=(0.39, 0.42, 0.48),
        )
        page.insert_text(
            (350, 483), str(n), fontname="helv", fontsize=8, color=(0.39, 0.42, 0.48)
        )
    raw = document.tobytes()
    document.close()
    return raw


def _seed_standard_templates(con):
    done = con.execute(
        "SELECT value FROM secrets WHERE name='seeded_standard_templates_v1'"
    ).fetchone()
    if done:
        return
    for tpl in STANDARD_LEGAL_TEMPLATES:
        existing = con.execute(
            "SELECT id, category, tone, audience, jurisdiction, output_format, clause_rules, custom_attrs "
            "FROM templates WHERE name=?",
            (tpl["name"],),
        ).fetchone()
        if existing:
            tid = existing["id"]
            con.execute(
                """UPDATE templates SET
                   category=CASE WHEN category='' OR category='Generale' THEN ? ELSE category END,
                   tone=CASE WHEN tone='' THEN ? ELSE tone END,
                   audience=CASE WHEN audience='' THEN ? ELSE audience END,
                   jurisdiction=CASE WHEN jurisdiction='' THEN ? ELSE jurisdiction END,
                   output_format=CASE WHEN output_format='' THEN ? ELSE output_format END,
                   clause_rules=CASE WHEN clause_rules='' THEN ? ELSE clause_rules END,
                   custom_attrs=CASE WHEN custom_attrs='' OR custom_attrs='[]' THEN ? ELSE custom_attrs END
                   WHERE id=?""",
                (
                    tpl["category"],
                    tpl["tone"],
                    tpl["audience"],
                    tpl["jurisdiction"],
                    tpl["output_format"],
                    tpl["clause_rules"],
                    dump(tpl["custom_attrs"]),
                    tid,
                ),
            )
        else:
            tid = con.execute(
                """INSERT INTO templates(
                    version,name,purpose,sections,fields,instructions,
                    category,tone,audience,jurisdiction,output_format,clause_rules,custom_attrs
                ) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    tpl["name"],
                    tpl["purpose"],
                    tpl["sections"],
                    tpl["fields"],
                    tpl["instructions"],
                    tpl["category"],
                    tpl["tone"],
                    tpl["audience"],
                    tpl["jurisdiction"],
                    tpl["output_format"],
                    tpl["clause_rules"],
                    dump(tpl["custom_attrs"]),
                ),
            ).lastrowid
        if tpl.get("example"):
            has_ex = con.execute(
                "SELECT 1 FROM template_examples WHERE template_id=? LIMIT 1", (tid,)
            ).fetchone()
            if not has_ex:
                ex = tpl["example"]
                con.execute(
                    "INSERT INTO template_examples(template_id,name,file,mime,extracted_text,notes) VALUES(?,?,?,?,?,?)",
                    (tid, ex["name"], None, "text/plain", ex["text"], ex["notes"]),
                )
    con.execute(
        "INSERT OR REPLACE INTO secrets(name, value) VALUES('seeded_standard_templates_v1', '1')"
    )


def initialize():
    with db() as con:
        setup(con)
        con.execute("BEGIN IMMEDIATE")
        already_initialized = con.execute("SELECT 1 FROM configs LIMIT 1").fetchone()
        if already_initialized:
            _seed_standard_templates(con)
            return
        cfg = {
            "version": 1,
            "prompt": DEFAULT_PROMPT,
            "model": "gemini-4-hydrogen",
            "level": "high",
            "tools": list(TOOLS),
            "semantic": True,
        }
        con.execute("INSERT INTO configs VALUES(1,?)", (dump(cfg),))
        _seed_standard_templates(con)
        con.execute("INSERT INTO matters VALUES(1,'Fornitura Orione')")
        old = ingest(
            con,
            1,
            "Contratto.pdf",
            pdf(
                "Contratto di fornitura",
                [
                    (
                        "Art. 1 · Oggetto",
                        [
                            "Fornitura Orione. Contratto sottoscritto il 12 marzo 2025.",
                            "Orione S.p.A. fornisce a Vega S.r.l. i materiali indicati nel listino.",
                        ],
                    ),
                    (
                        "Art. 3 · Consegna",
                        [
                            "Le parti concordano il seguente calendario.",
                            "La merce viene consegnata entro il quinto giorno lavorativo del mese.",
                        ],
                    ),
                    (
                        "Art. 5 · Pagamenti",
                        [
                            "Le parti applicano i prezzi indicati nel listino.",
                            "Il pagamento avviene tramite bonifico a fronte di fattura.",
                        ],
                    ),
                    (
                        "Art. 8 · Recesso",
                        [
                            "Ciascuna parte può recedere dal rapporto mediante comunicazione scritta.",
                            OLD,
                            "La comunicazione deve essere inviata tramite PEC.",
                        ],
                    ),
                ],
            ),
        )
        new = ingest(
            con,
            1,
            "Addendum.pdf",
            pdf(
                "Addendum al contratto di fornitura",
                [
                    (
                        "Art. 2 · Preavviso",
                        [
                            "Tra Orione S.p.A. e Vega S.r.l. si conviene quanto segue.",
                            NEW,
                            "La presente clausola sostituisce l'art. 8 del contratto di fornitura per quanto riguarda il termine di preavviso.",
                        ],
                    ),
                    (
                        "Art. 3 · Decorrenza",
                        [
                            "Le parti confermano le restanti disposizioni del contratto.",
                            "L'addendum ha effetto dal 1 giugno 2025.",
                        ],
                    ),
                ],
            ),
        )
        book = Workbook()
        sheet = book.active
        sheet.title = "Prezzi"
        sheet.append(["Articolo", "Prezzo EUR"])
        sheet.append(["Kit Orione", 1250])
        out = io.BytesIO()
        book.save(out)
        ingest(con, 1, "Listino.xlsx", out.getvalue())
        sid = new_session(con, 1, "Revisione del preavviso", [old, new])
        sources = []
        for doc, quote in [(old, OLD), (new, NEW)]:
            r = con.execute(
                "SELECT c.*,d.name FROM chunks c JOIN docs d ON c.doc=d.id WHERE doc=? AND text LIKE ?",
                (doc, quote + "%"),
            ).fetchone()
            sources.append(
                {
                    "id": r["id"],
                    "doc": doc,
                    "name": r["name"],
                    "label": r["label"],
                    "page": r["page"],
                    "quote": quote,
                    "rects": json.loads(r["rects"]),
                    "visual": False,
                }
            )
        result = {
            "text": "Il termine aggiornato è di **60 giorni**.\n\n| Documento | Preavviso |\n| --- | --- |\n| Contratto originario | 30 giorni [1] |\n| Addendum firmato | **60 giorni** [2] |\n\nL’art. 2 dell’addendum modifica il termine previsto dall’art. 8 del contratto.",
            "sources": sources,
            "trace": [],
            "configVersion": 1,
            "mode": "example",
            "model": None,
            "level": None,
        }
        con.execute(
            "INSERT INTO turns(session,request,result) VALUES(?,?,?)",
            (
                sid,
                "Quale termine di preavviso devo comunicare al cliente?",
                dump(result),
            ),
        )
