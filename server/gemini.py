import base64
import json
import math
import time
from functools import lru_cache

import httpx
from fastapi import HTTPException

from .store import key

BASE = "https://generativelanguage.googleapis.com/v1beta/models/"
EMBED = "gemini-embedding-2"


def request(method, suffix, payload=None):
    try:
        res = httpx.request(
            method,
            BASE + suffix,
            json=payload,
            headers={"x-goog-api-key": key() or ""},
            timeout=100,
        )
    except httpx.RequestError as e:
        raise HTTPException(
            503, "Gemini non raggiungibile. Verifica la connessione e riprova."
        ) from e
    if res.is_error:
        status = res.status_code
        reasons = {
            400: "Richiesta rifiutata. Verifica modello, livello e dimensione dei file.",
            401: "Chiave Gemini non valida.",
            403: "Chiave Gemini priva di accesso al servizio.",
            404: "Modello non disponibile per questo progetto.",
            429: "Quota Gemini esaurita o limite temporaneo raggiunto.",
        }
        raise HTTPException(
            502, "Gemini · " + reasons.get(status, f"Errore del servizio ({status}).")
        )
    return res.json()


@lru_cache(maxsize=4)
def input_limit(model):
    return int(request("GET", model)["inputTokenLimit"])


def count(model, body):
    if key():
        payload = {"model": "models/" + model, **body}
        n = request(
            "POST", model + ":countTokens", {"generateContentRequest": payload}
        )["totalTokens"]
        return {"used": n, "limit": input_limit(model), "estimated": False}
    chars = sum(
        len(p.get("text", ""))
        for c in [body["systemInstruction"], *body["contents"]]
        for p in c["parts"]
    )
    media = sum(
        math.ceil(len(p["inlineData"]["data"]) * 0.75 / 700) + 258
        for c in body["contents"]
        for p in c["parts"]
        if "inlineData" in p
    )
    return {"used": math.ceil(chars / 4) + media, "limit": 1_048_576, "estimated": True}


def generate(model, level, body, schema):
    result = request(
        "POST",
        model + ":generateContent",
        {
            **body,
            "generationConfig": {
                "thinkingConfig": {"thinkingLevel": level.upper()},
                "responseMimeType": "application/json",
                "responseJsonSchema": schema,
            },
        },
    )
    try:
        parts = result["candidates"][0]["content"]["parts"]
        return json.loads(
            "".join(p.get("text", "") for p in parts if not p.get("thought"))
        )
    except (KeyError, IndexError, ValueError) as e:
        raise HTTPException(
            502,
            "Gemini non ha completato una risposta utilizzabile. Riprova o riformula la domanda.",
        ) from e


def embed(texts, kind):
    def formatted(s):
        if kind == "document":
            title, _, content = s.partition("\n")
            return f"title: {title} | text: {content}"
        return "task: search result | query: " + s

    requests = [
        {
            "model": "models/" + EMBED,
            "content": {"parts": [{"text": formatted(s)}]},
            "outputDimensionality": 768,
        }
        for s in texts
    ]
    res = request("POST", EMBED + ":batchEmbedContents", {"requests": requests})
    vectors = [e["values"] for e in res["embeddings"]]
    if len(vectors) != len(texts):
        raise HTTPException(
            502, "Indicizzazione semantica incompleta. Riprova la ricerca."
        )
    return vectors


@lru_cache(maxsize=64)
def uploaded_uri(path, mime, day):
    # Gemini Files expire after 48 hours. Reuse a reference within the same UTC day.
    try:
        with httpx.Client(timeout=120) as client:
            start = client.post(
                "https://generativelanguage.googleapis.com/upload/v1beta/files",
                headers={
                    "x-goog-api-key": key(),
                    "X-Goog-Upload-Protocol": "resumable",
                    "X-Goog-Upload-Command": "start",
                    "X-Goog-Upload-Header-Content-Length": str(path.stat().st_size),
                    "X-Goog-Upload-Header-Content-Type": mime,
                },
                json={"file": {"display_name": path.name}},
            )
            start.raise_for_status()
            with path.open("rb") as original:
                upload = client.post(
                    start.headers["x-goog-upload-url"],
                    headers={
                        "Content-Length": str(path.stat().st_size),
                        "X-Goog-Upload-Offset": "0",
                        "X-Goog-Upload-Command": "upload, finalize",
                    },
                    content=original,
                )
            upload.raise_for_status()
            file = upload.json()["file"]
            for _ in range(30):
                if file.get("state") == "ACTIVE":
                    return file["uri"]
                if file.get("state") == "FAILED":
                    break
                time.sleep(1)
                status = client.get(
                    "https://generativelanguage.googleapis.com/v1beta/" + file["name"],
                    headers={"x-goog-api-key": key()},
                )
                status.raise_for_status()
                file = status.json()
    except (httpx.HTTPError, KeyError, ValueError) as e:
        raise HTTPException(
            502,
            "Gemini Files non ha accettato l'allegato. Verifica la connessione e riprova.",
        ) from e
    raise HTTPException(
        503, "L'allegato non è ancora disponibile presso Gemini. Riprova."
    )


def media(path, mime, external=False):
    if external and key():
        return {
            "fileData": {
                "mimeType": mime,
                "fileUri": uploaded_uri(path, mime, int(time.time() // 86400)),
            }
        }
    return {
        "inlineData": {
            "mimeType": mime,
            "data": base64.b64encode(path.read_bytes()).decode("ascii"),
        }
    }
