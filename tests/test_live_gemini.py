"""Opt-in smoke test with synthetic files and the configured Gemini project."""

import os
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from server.app import app
from server.store import key


@unittest.skipUnless(
    os.getenv("INDICE_TEST_GEMINI") == "1" and key(),
    "Richiede una chiave Gemini e INDICE_TEST_GEMINI=1",
)
class LiveGemini(unittest.TestCase):
    def test_contract_addendum_and_missing_evidence(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.dict(os.environ, {"INDICE_DATA_DIR": folder}),
            TestClient(app) as client,
        ):
            created = client.post(
                "/api/matters/1/sessions", json={"name": "Prova Gemini"}
            )
            created.raise_for_status()
            sid = created.json()["id"]
            for q, expected in [
                ("Qual è il termine di preavviso indicato nel contratto?", "30"),
                (
                    "Cerca anche nel fascicolo: il termine di preavviso è stato modificato?",
                    "60",
                ),
                (
                    "Quale penale è fissata per la mancata partecipazione a un arbitrato marittimo?",
                    None,
                ),
            ]:
                rev = client.get(f"/api/sessions/{sid}").json()["revision"]
                response = client.post(
                    f"/api/sessions/{sid}/send",
                    json={"question": q, "revision": rev, "nonce": uuid4().hex},
                )
                self.assertEqual(response.status_code, 200, response.text[:400])
                turn = response.json()["turns"][-1]
                self.assertEqual(turn["mode"], "gemini")
                if expected:
                    self.assertIn(expected, turn["text"])
                    self.assertTrue(
                        any(expected in source["quote"] for source in turn["sources"])
                    )
                else:
                    self.assertRegex(turn["text"].lower(), "non |nessun|assent|manca")
