import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pymupdf
from docx import Document
from fastapi.testclient import TestClient
from PIL import Image

from server import assistant, gemini, search
from server.app import app
from server.store import db


class Workflows(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        env = patch.dict(
            os.environ,
            {
                "INDICE_DATA_DIR": folder.name,
                "GEMINI_API_KEY": "",
                "GOOGLE_API_KEY": "",
            },
        )
        env.start()
        self.addCleanup(env.stop)
        self.client = TestClient(app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.session = self.req(
            "post", "/matters/1/sessions", json={"name": "Prova fonti"}
        )["id"]

    def req(self, method, path, **kwargs):
        response = getattr(self.client, method)("/api" + path, **kwargs)
        self.assertLess(response.status_code, 300, response.text[:800])
        return response.json()

    def session_data(self):
        return self.req("get", "/sessions/" + str(self.session))

    def draft(self, q, **kwargs):
        return {
            "question": q,
            "revision": self.session_data()["revision"],
            "nonce": uuid4().hex,
            **kwargs,
        }

    def send(self, q, **kwargs):
        return self.req(
            "post", f"/sessions/{self.session}/send", json=self.draft(q, **kwargs)
        )["turns"][-1]

    def change(self, **kwargs):
        s = self.session_data()
        return self.req(
            "put",
            f"/sessions/{self.session}",
            json={
                **{k: s[k] for k in ("model", "level", "selected", "revision")},
                **kwargs,
            },
        )

    def upload(self, name, data, attach=False):
        return self.req(
            "post",
            f"/sessions/{self.session}/upload",
            files={"file": (name, data)},
            data={"attach": str(attach).lower()},
        )

    def test_contract_archive_citations_and_missing(self):
        turn = self.send("Qual è il preavviso?")
        self.assertIn("30 giorni", turn["text"])
        self.assertNotIn("60 giorni", turn["text"])
        turn = self.send("Cerca anche nel fascicolo il preavviso")
        self.assertIn("60 giorni", turn["text"])
        self.assertIn("30 giorni", turn["text"])
        cited = next(s for s in turn["sources"] if "60 giorni" in s["quote"])
        self.assertEqual(cited["page"], 1)
        self.assertTrue(cited["rects"])
        original = self.client.get(f"/api/docs/{cited['doc']}/original")
        with pymupdf.open(stream=original.content, filetype="pdf") as pdf:
            self.assertIn(cited["quote"], pdf[cited["page"] - 1].get_text())
            self.assertIn("Addendum", pdf[0].get_text())
        self.assertIn("non ha trovato", self.send("Arbitrato marittimo?")["text"])
        exact = self.req(
            "post", "/matters/1/search", json={"query": "Riporta l’art. 8"}
        )
        self.assertEqual(exact["method"], "Ricerca puntuale")
        self.assertTrue(any("30 giorni" in s["quote"] for s in exact["sources"]))
        missing = self.req(
            "post", "/matters/1/search", json={"query": "Riporta l'art. 999"}
        )
        self.assertEqual(missing["sources"], [])
        sheet_range = self.req(
            "post", "/matters/1/search", json={"query": "Prezzi!A2:B2"}
        )
        self.assertEqual(
            [s["label"] for s in sheet_range["sources"]], ["Prezzi!A2", "Prezzi!B2"]
        )

    def test_formats_and_source_locators(self):
        word = Document()
        word.add_paragraph("Condizione speciale concordata")
        word.add_table(1, 1).cell(0, 0).text = "Indennizzo una tantum"
        stream = io.BytesIO()
        word.save(stream)
        a = self.upload("Allegato.docx", stream.getvalue(), True)
        parts = self.req("get", f"/docs/{a['doc']}/passages")
        self.assertEqual(
            [p["label"] for p in parts], ["Paragrafo 1", "Tabella 2 · riga 1"]
        )
        self.assertIn(a["doc"], a["session"]["selected"])
        comma = self.upload("Importi.csv", b"Voce;Importo\nAcconto;500")
        self.assertNotIn(comma["doc"], comma["session"]["selected"])
        cells = self.req("get", f"/docs/{comma['doc']}/passages")
        self.assertTrue(any(p["label"] == "B2" and p["quote"] == "500" for p in cells))
        excel = self.req("post", "/matters/1/search", json={"query": "Prezzi!B2"})
        self.assertTrue(
            any(
                s["label"] == "Prezzi!B2" and s["quote"] == "1250"
                for s in excel["sources"]
            )
        )
        t = self.upload("Nota.txt", b"Prima riga\nGaranzia documentata.")
        self.assertEqual(
            self.req("get", f"/docs/{t['doc']}/passages")[1]["label"], "Riga 2"
        )
        for extension, kind in [("png", "PNG"), ("jpg", "JPEG")]:
            buffer = io.BytesIO()
            Image.new("RGB", (20, 20), "white").save(buffer, kind)
            im = self.upload("Scansione." + extension, buffer.getvalue())
            self.assertTrue(self.req("get", f"/docs/{im['doc']}/passages")[0]["visual"])
        with pymupdf.open() as pdf:
            pdf.new_page()
            scan = self.upload("Scansione.pdf", pdf.tobytes())
        self.assertTrue(self.req("get", f"/docs/{scan['doc']}/passages")[0]["visual"])

    def test_isolation_versions_idempotence_and_restart(self):
        self.change(model="gemini-4-neon", level="medium", selected=[2])
        config = self.req("get", "/studio")["settings"]
        config["prompt"] = "Usa un elenco numerato."
        self.req("put", "/config", json=config)
        t = next(x for x in self.req("get", "/studio")["templates"] if x["id"] == 1)
        t["fields"] = "Cliente\nNumero pratica"
        self.req("put", "/templates/1", json=t)
        question = self.draft("Prepara una nota", template=1)
        self.req("post", f"/sessions/{self.session}/send", json=question)
        result = self.req("post", f"/sessions/{self.session}/send", json=question)
        self.assertEqual(len(result["turns"]), 1)
        turn = result["turns"][-1]
        self.assertEqual(turn["configVersion"], 2)
        self.assertEqual(turn["template"]["version"], 2)
        self.assertIn("Numero pratica", turn["text"])
        from server.demo import initialize

        initialize()
        self.assertEqual(self.session_data()["selected"], [2])
        self.assertEqual(self.session_data()["model"], "gemini-4-neon")
        other = self.req("post", "/matters", json={"name": "Separata"})
        resp = self.client.put(
            f"/api/sessions/{other['session']}",
            json={
                "selected": [1],
                "revision": 0,
                "model": "gemini-4-neon",
                "level": "low",
            },
        )
        self.assertEqual(resp.status_code, 422)
        self.assertFalse(
            self.req(
                "post", f"/matters/{other['id']}/search", json={"query": "preavviso"}
            )["sources"]
        )
        self.assertEqual(self.client.put("/api/config", json=config).status_code, 409)

    def test_context_payload_attachment_removal_and_limit(self):
        from server.app import Draft

        def build():
            with db() as con:
                return assistant.prepare(con, self.session, Draft(question="Verifica"))[
                    "body"
                ]

        def media_count(body):
            return sum("inlineData" in p for c in body["contents"] for p in c["parts"])

        first = build()
        self.assertEqual(media_count(first), 1)
        self.send("Preavviso?")
        self.change(selected=[])
        second = build()
        self.assertEqual(media_count(second), 0)
        self.assertIn("30 giorni", second["contents"][1]["parts"][0]["text"])
        self.assertNotIn("ORIONE   /", second["contents"][-1]["parts"][-1]["text"])
        with patch.object(
            gemini,
            "count",
            return_value={"used": 101, "limit": 100, "estimated": False},
        ):
            r = self.client.post(
                f"/api/sessions/{self.session}/send",
                json=self.draft("Controllo limite"),
            )
        self.assertEqual(r.status_code, 413)
        self.assertEqual(len(self.session_data()["turns"]), 1)

    def test_live_adapter_contract_with_simulated_transport(self):
        assistant.interpret.cache_clear()
        gemini.input_limit.cache_clear()
        search.query_vector.cache_clear()
        calls = []

        def transport(method, path, payload=None):
            calls.append((path, payload))
            if method == "GET":
                return {"inputTokenLimit": 1048576}
            if path.endswith(":countTokens"):
                self.assertIn("systemInstruction", payload["generateContentRequest"])
                return {"totalTokens": 350}
            if path.endswith(":batchEmbedContents"):
                return {
                    "embeddings": [{"values": [1.0, 0.0]} for _ in payload["requests"]]
                }
            schema = payload["generationConfig"]["responseJsonSchema"]
            if "archive" in schema["properties"]:
                data = {
                    "archive": True,
                    "query": "preavviso",
                    "full": "",
                    "template": "",
                }
            else:
                self.assertEqual(
                    payload["generationConfig"]["thinkingConfig"]["thinkingLevel"],
                    "HIGH",
                )
                catalog = json.loads(
                    payload["contents"][-1]["parts"][-1]["text"]
                    .split(":\n", 1)[1]
                    .split("\n\nRichiesta:")[0]
                )
                clause = next(c for c in catalog if "60 giorni" in c["testo"])
                data = {
                    "text": "Il termine è di 60 giorni [s" + str(clause["id"]) + "].",
                    "citations": [{"id": clause["id"], "quote": clause["testo"]}],
                }
            return {
                "candidates": [{"content": {"parts": [{"text": json.dumps(data)}]}}]
            }

        with (
            patch.dict(os.environ, {"GEMINI_API_KEY": "fixture"}),
            patch.object(gemini, "request", side_effect=transport),
        ):
            turn = self.send("Verifica nel fascicolo il preavviso.")
        self.assertEqual(turn["mode"], "gemini")
        self.assertEqual(turn["sources"][0]["name"], "Addendum.pdf")
        self.assertEqual(turn["sources"][0]["page"], 1)
        self.assertEqual(turn["meter"]["used"], 350)
        self.assertTrue(any(":batchEmbedContents" in path for path, _ in calls))
        self.assertTrue(any("ibrida" in x for x in turn["trace"]))

    def test_invalid_citation_and_failed_upload(self):
        with self.assertRaises(ValueError):
            assistant.verify(
                {"text": "Fatto [s1]", "citations": [{"id": 999, "quote": "assente"}]},
                {},
            )
        before = self.session_data()
        r = self.client.post(
            f"/api/sessions/{self.session}/upload",
            files={"file": ("file.pdf", b"corrotto")},
        )
        self.assertEqual(r.status_code, 422)
        self.assertEqual(before, self.session_data())

    def test_api_key_in_app_save_mask_and_clear(self):
        st0 = self.req("get", "/studio")
        self.assertFalse(st0["online"])
        self.assertEqual(st0["apiKey"]["source"], "none")
        saved = self.req("put", "/config/api-key", json={"apiKey": "AIzaSyTest12345678"})
        self.assertTrue(saved["online"])
        self.assertEqual(saved["apiKey"]["source"], "app")
        self.assertEqual(saved["apiKey"]["masked"], "AIza••••5678")
        st1 = self.req("get", "/studio")
        self.assertTrue(st1["online"])
        self.assertNotIn("AIzaSyTest12345678", json.dumps(st1))
        cleared = self.req("put", "/config/api-key", json={"apiKey": ""})
        self.assertFalse(cleared["online"])
        self.assertEqual(cleared["apiKey"]["source"], "none")

    def test_delete_session_and_delete_matter(self):
        other = self.req("post", "/matters", json={"name": "Da eliminare"})
        m_id = other["id"]
        s1 = other["session"]
        s2 = self.req("post", f"/matters/{m_id}/sessions", json={"name": "Seconda chat"})["id"]
        del_s2 = self.req("delete", f"/sessions/{s2}")
        self.assertEqual(del_s2["nextSession"], s1)
        s1_turn = self.req(
            "post",
            f"/sessions/{s1}/send",
            json={
                "question": "Ciao",
                "revision": self.req("get", f"/sessions/{s1}")["revision"],
                "nonce": uuid4().hex,
            },
        )
        self.assertEqual(len(s1_turn["turns"]), 1)
        # Deleting the last session of a matter creates a clean fallback session
        del_s1 = self.req("delete", f"/sessions/{s1}")
        fallback = self.req("get", f"/sessions/{del_s1['nextSession']}")
        self.assertEqual(fallback["title"], "Nuova conversazione")
        self.assertEqual(fallback["turns"], [])
        # Deleting the entire matter removes all its sessions and docs
        del_m = self.req("delete", f"/matters/{m_id}")
        self.assertEqual(del_m["deleted"], m_id)
        st = self.req("get", "/studio")
        self.assertFalse(any(m["id"] == m_id for m in st["matters"]))
        # Deleting the remaining demo matter works cleanly and stays deleted across initialize()
        self.req("delete", "/matters/1")
        st_empty = self.req("get", "/studio")
        self.assertEqual(st_empty["matters"], [])
        from server.demo import initialize

        initialize()
        self.assertEqual(self.req("get", "/studio")["matters"], [])

    def test_retrieval_folders_sync_toggle_and_browse(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            (root / "sub").mkdir()
            (root / "Nota_Verbale.txt").write_text(
                "Verbale sopralluogo clausola speciale alfa99.", encoding="utf-8"
            )
            (root / "sub" / "Allegato_Tecnico.md").write_text(
                "# Specifiche\nValore indennizzo beta44 pari a 9000 EUR.", encoding="utf-8"
            )
            browse = self.req("get", f"/fs/browse?path={raw_dir}")
            self.assertEqual(browse["supportedFilesCount"], 1)
            self.assertEqual(browse["entries"][0]["name"], "sub")

            added = self.req(
                "post",
                "/matters/1/folders",
                json={"path": raw_dir, "label": "Cartella Verbali", "recursive": True},
            )
            fid = added["folder"]["id"]
            self.assertEqual(added["sync"]["added"], 2)
            self.assertEqual(added["folder"]["fileCount"], 2)

            hit1 = self.req("post", "/matters/1/search", json={"query": "alfa99"})
            self.assertTrue(any("alfa99" in s["quote"] for s in hit1["sources"]))
            hit2 = self.req("post", "/matters/1/search", json={"query": "beta44"})
            self.assertTrue(any("beta44" in s["quote"] for s in hit2["sources"]))

            # Disable folder -> excluded from retrieval
            self.req("put", f"/matters/1/folders/{fid}", json={"enabled": False})
            hit_paused = self.req("post", "/matters/1/search", json={"query": "alfa99"})
            self.assertEqual(hit_paused["sources"], [])

            # Re-enable, update disk files, and sync
            self.req("put", f"/matters/1/folders/{fid}", json={"enabled": True})
            (root / "Nota_Verbale.txt").unlink()
            (root / "Nuovo_Atto.txt").write_text("Clausola gamma77 aggiornata.", encoding="utf-8")
            synced = self.req("post", f"/matters/1/folders/{fid}/sync")
            self.assertEqual(synced["sync"]["added"], 1)
            self.assertEqual(synced["sync"]["removed"], 1)
            hit_new = self.req("post", "/matters/1/search", json={"query": "gamma77"})
            self.assertTrue(any("gamma77" in s["quote"] for s in hit_new["sources"]))

            # Unlink folder
            self.req("delete", f"/matters/1/folders/{fid}")
            hit_gone = self.req("post", "/matters/1/search", json={"query": "gamma77"})
            self.assertEqual(hit_gone["sources"], [])

    def test_document_models_examples_chat_compilation_and_docx_export(self):
        st = self.req("get", "/studio")
        names = {t["name"] for t in st["templates"]}
        self.assertGreaterEqual(len(names), 6)
        self.assertIn("Lettera di diffida e messa in mora", names)
        self.assertIn("Accordo di riservatezza (NDA)", names)

        created = self.req(
            "post",
            "/templates",
            json={
                "name": "Memoria difensiva test",
                "category": "Contenzioso",
                "purpose": "Difesa in giudizio",
                "tone": "Formale giudiziale",
                "audience": "Tribunale",
                "jurisdiction": "Codice di procedura civile",
                "output_format": "Atto giudiziario",
                "sections": "Epigrafe\nFatto\nDiritto\nConclusioni",
                "fields": "Tribunale competente\nParte convenuta",
                "clause_rules": "Indicare numero ruolo se noto",
                "instructions": "Redigi in stile forense.",
                "custom_attrs": [{"key": "Massima estensione", "value": "10 pagine"}],
            },
        )
        tid = created["id"]
        self.assertEqual(created["custom_attrs"][0]["key"], "Massima estensione")

        with_text_ex = self.req(
            "post",
            f"/templates/{tid}/examples/text",
            json={
                "name": "Esempio_incipit.txt",
                "text": "ILL.MO TRIBUNALE DI MILANO - Comparsa di costituzione e risposta.",
                "notes": "Imita intestazione",
            },
        )
        self.assertEqual(len(with_text_ex["examples"]), 1)

        with_file_ex = self.req(
            "post",
            f"/templates/{tid}/examples/file",
            files={"file": ("modello_stile.txt", b"Conclusioni: voglia l'Ill.mo Tribunale...")},
            data={"notes": "Stile conclusioni"},
        )
        self.assertEqual(len(with_file_ex["examples"]), 2)

        # Multi-turn compilation from chat directives
        t1 = self.send(
            "Compila per Tribunale competente: Tribunale di Milano. Parte convenuta: Beta S.r.l.",
            template=tid,
        )
        self.assertIn("document", t1)
        compiled_fields = {f["field"]: f["value"] for f in t1["document"]["compiledFields"]}
        self.assertEqual(compiled_fields["Tribunale competente"], "Tribunale di Milano")
        self.assertEqual(compiled_fields["Parte convenuta"], "Beta S.r.l.")

        # Export DOCX
        docx_res = self.client.post(
            "/api/export/docx",
            json={"title": t1["document"]["title"], "content": t1["document"]["content"]},
        )
        self.assertEqual(docx_res.status_code, 200)
        self.assertTrue(docx_res.content.startswith(b"PK"))

        # Delete example and model
        eid = with_text_ex["examples"][0]["id"]
        self.req("delete", f"/templates/{tid}/examples/{eid}")
        self.req("delete", f"/templates/{tid}")

    def test_tabular_and_chart_outputs_and_multi_retrieval_orchestrator(self):
        # Composite multi-retrieval query: exact clause + document summary + cell range + concept
        turn_multi = self.send(
            "Cerca nel fascicolo e riporta l'art. 8 del Contratto, fai un riassunto dell'Addendum, "
            "leggi Prezzi!B2 e confronta i rischi sul recesso in tabella.",
            archive=True,
            output_mode="table",
        )
        strategies = {step["strategy"] for step in turn_multi["plan"]}
        self.assertIn("exact_clause", strategies)
        self.assertIn("cell_range", strategies)
        self.assertIn("document_summary", strategies)
        self.assertIn("semantic_concept", strategies)
        self.assertTrue(turn_multi.get("tables"))
        self.assertIn("1250", turn_multi["text"])
        self.assertIn("30 giorni", turn_multi["text"])
        self.assertIn("60 giorni", turn_multi["text"])

        # Chart / timeline output
        turn_chart = self.send(
            "Cerca nel fascicolo il preavviso e le date di decorrenza per creare un grafico.",
            archive=True,
            output_mode="chart",
        )
        self.assertTrue(turn_chart.get("charts"))


if __name__ == "__main__":
    unittest.main()
