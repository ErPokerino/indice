import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-pdf-resources",
      apply: "build",
      generateBundle() {
        for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
          const directory = join("node_modules", "pdfjs-dist", folder);
          for (const name of readdirSync(directory)) {
            this.emitFile({
              type: "asset",
              fileName: "pdfjs/" + folder + "/" + name,
              source: readFileSync(join(directory, name)),
            });
          }
        }
      },
    },
  ],
  server: { proxy: { "/api": "http://127.0.0.1:8765" } },
  build: { chunkSizeWarningLimit: 900 },
});
