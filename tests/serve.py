import os
import tempfile

import uvicorn

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="indice-browser-") as folder:
        os.environ.update(INDICE_DATA_DIR=folder, GEMINI_API_KEY="", GOOGLE_API_KEY="")
        uvicorn.run("server.app:app", host="127.0.0.1", port=18765)
