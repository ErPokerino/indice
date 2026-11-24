# Indice

Applicazione locale per gestire pratiche legali, indicizzare cartelle documentali, conversare con Gemini con citazioni verificabili sulle fonti originali e compilare modelli di documenti legali in chat. La pratica iniziale **Fornitura Orione** contiene un contratto, un addendum e un listino interamente fittizi.

## Avvio su Windows

Sono necessari Node.js 22.13 o successivo e [uv](https://docs.astral.sh/uv/). Dalla cartella del progetto eseguire:

```powershell
npm.cmd start
```

Lo script prepara Python 3.12, installa le dipendenze, compila il frontend e avvia l’app su **[127.0.0.1:8765](http://127.0.0.1:8765)**. Per arrestarla premere Ctrl+C nel terminale di avvio.

### Configurazione chiave API Gemini

È possibile attivare Gemini in **due modi**:
1. **Direttamente dall'app**: aprire **Configurazione → Assistente**, incollare la propria chiave API Gemini, cliccare **Salva chiave** (salvata localmente nel database `.indice/indice.sqlite3`) ed eventualmente **Testa connessione**.
2. **Da file `.env` o variabile d'ambiente**: impostare `GEMINI_API_KEY` in `.env` (copiando `.env.example`) oppure come variabile d'ambiente.

In assenza di chiave, **Modalità locale** consente comunque di navigare le pratiche, sincronizzare cartelle, cercare passaggi, compilare bozze dai modelli ed esplorare tabelle e grafici estrattivi.

## Funzionalità principali

- **Cartelle di retrieval per pratica**: in **Cartelle retrieval** (o nella scheda **Cartelle** dell'inspector) è possibile collegare cartelle locali tramite percorso o esploratore integrato, includere sottocartelle, mettere in pausa/attivare singole cartelle e sincronizzare modifiche incrementali.
- **Modelli di documenti legali + Esempi allegati**: include modelli standard preconfigurati (*Nota al cliente*, *Parere legale motivato*, *Lettera di diffida e messa in mora*, *Accordo di riservatezza NDA*, *Addendum contrattuale*, *Scheda di Due Diligence / Red Flag Report*) con categoria, tono, destinatario, giurisdizione, regole clausole, caratteristiche personalizzate ed **esempi allegabili** (file o testo) da cui trarre spunto.
- **Compilazione guidata in chat ed export DOCX**: attivando un modello di documento, le indicazioni fornite dall'utente nella chat (e nei turni successivi) vengono recepite per compilare campi e sezioni, evidenziando solo i dati mancanti (`[DA COMPLETARE: ...]`) ed esportando il risultato in `.docx` o `.md`.
- **Output tabulari, grafici e timeline**: l'assistente (o il selettore *Formato risposta*) produce tabelle interattive ordinabili/filtrabili (esportabili in CSV) e grafici SVG (`bar`, `horizontal_bar`, `line`, `donut`, `timeline` cronologiche).
- **Orchestratore agentico multi-retrieval**: scompone richieste complesse in più strategie simultanee (`exact_clause`, `cell_range`, `document_summary`, `semantic_concept`, `full_document`) e attiva skill modulari verificabili in **Dettagli** e in **Configurazione → Orchestratore**. Approfondimenti in [ARCHITETTURA_E_ROADMAP.md](docs/ARCHITETTURA_E_ROADMAP.md).
- **Gestione completa pratiche e conversazioni**: creazione ed eliminazione sicura con conferma per pratiche, conversazioni e singoli documenti.

## Sviluppo e verifica

Frontend React, TypeScript, Vite, Radix UI e PDF.js. Backend FastAPI. Per lo sviluppo si può avviare Uvicorn su 8765 e il frontend con `npm.cmd run dev`.

```powershell
uv sync --locked --python 3.12
npm.cmd ci
npm.cmd run build
uv run --no-sync python -m unittest discover -s tests -v
npx.cmd playwright test
```

I test browser utilizzano Chrome e avviano un servizio separato sulla porta 18765 con dati temporanei. Per eseguire anche la prova con chiamate reali e una chiave abilitata:

```powershell
$env:INDICE_TEST_GEMINI = '1'
uv run --no-sync python -m unittest tests.test_live_gemini -v
```
