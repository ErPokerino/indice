import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";

test("dalla risposta al documento originale, anche su mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Revisione del preavviso" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Contratto · p. 4", exact: true })
    .click();
  await expect(page.getByText("Pagina 4 di 4")).toBeVisible();
  await expect(page.locator(".highlight")).toBeVisible();
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  await page
    .getByRole("button", { name: "Addendum · p. 1", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Pagina 1 di 2"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Modalità vocale · anteprima" })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Gemini 3.8 Live"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("nuova conversazione, selezione persistente, ricerca e allegati", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Nuova conversazione", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "Messaggio", exact: true });
  await input.fill("Qual è il termine di preavviso?");
  await input.press("Enter");
  await expect(page.locator(".answer").last()).toContainText("30 giorni");
  await expect(page.locator(".answer").last()).not.toContainText("60 giorni");
  await input.fill("Cerca anche nel fascicolo il termine di preavviso");
  await input.press("Enter");
  await expect(page.locator(".answer").last()).toContainText("60 giorni");
  await page
    .getByRole("button", { name: "Cerca nel fascicolo", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Termine di ricerca" })
    .fill("Prezzi!B2");
  await page.getByRole("button", { name: "Cerca", exact: true }).click();
  const hit = page.locator(".search-hit").filter({ hasText: "1250" });
  await hit.getByRole("button", { name: "Aggiungi documento intero" }).click();
  await hit.getByRole("button", { name: /Listino/ }).click();
  await expect(page.locator(".extract [data-active=true]")).toContainText(
    "1250",
  );
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Rimuovi dal contesto Listino.xlsx" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Allega documenti" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "Nota.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Numero intervento 578."),
    });
  await page
    .getByRole("button", { name: "Carica documenti", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Rimuovi dal contesto Nota.txt" }),
  ).toBeVisible();
});

test("chiave API in app, modelli di documenti con compilazione in chat, grafici/tabelle, cartelle retrieval e cancellazione", async ({
  page,
}) => {
  await page.goto("/");

  // 1. Chiave API in Configurazione
  await page
    .getByRole("button", { name: "Configurazione", exact: true })
    .click();
  await page
    .getByLabel("Chiave API Gemini", { exact: true })
    .fill("AIzaSyDemoPlaywright9999");
  await page.getByRole("button", { name: "Salva chiave" }).click();
  await expect(page.getByRole("dialog")).toContainText("Salvata in app");
  await page.getByRole("button", { name: "Rimuovi chiave" }).click();
  await expect(page.getByRole("dialog")).toContainText("Non configurata");

  const instructions = page.getByLabel(/Prompt di sistema/);
  await instructions.fill("Scrivi in italiano e cita i documenti disponibili.");
  await page.getByRole("button", { name: "Salva configurazione" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 2. Modelli di documenti (ex Archetipi) + compilazione guidata in chat
  await page
    .getByRole("button", { name: "Modelli di documenti", exact: true })
    .click();
  await page.getByRole("button", { name: "Nuovo modello", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Promemoria udienza");
  await page.getByLabel("Sezioni, una per riga").fill("Fatti\nRichieste");
  await page
    .getByLabel("Campi richiesti, uno per riga")
    .fill("Data udienza\nGiudice");
  await page.getByRole("button", { name: "Salva modello" }).click();
  await page
    .locator(".template-card")
    .filter({ hasText: "Promemoria udienza" })
    .getByRole("button", { name: "Usa in chat" })
    .click();
  await page.getByRole("combobox", { name: "Modello Gemini" }).click();
  await page.getByRole("option", { name: "Neon" }).click();
  await expect(
    page.getByRole("combobox", { name: "Modello Gemini" }),
  ).toHaveText("Neon");

  const msgBox = page.getByRole("textbox", { name: "Messaggio", exact: true });
  await msgBox.fill(
    "Compila per Data udienza: 15 dicembre 2025. Giudice: Dott.ssa Bianchi.",
  );
  await page.getByRole("button", { name: "Invia messaggio" }).click();
  await expect(page.locator(".doc-card").last()).toContainText(
    "15 dicembre 2025",
  );
  await expect(page.locator(".doc-card").last()).toContainText(
    "Dott.ssa Bianchi",
  );

  // 3. Output tabellare e grafico in chat
  await page.getByRole("button", { name: "Rimuovi modello attivo" }).click();
  await page.getByRole("combobox", { name: "Formato risposta" }).click();
  await page.getByRole("option", { name: "Tabella" }).click();
  await msgBox.fill("Cerca nel fascicolo il preavviso e confrontalo in tabella");
  await msgBox.press("Enter");
  await expect(page.locator(".rich-table").last()).toBeVisible();

  await page.getByRole("combobox", { name: "Formato risposta" }).click();
  await page.getByRole("option", { name: "Grafico" }).click();
  await msgBox.fill("Cerca nel fascicolo il preavviso e mostra un grafico");
  await msgBox.press("Enter");
  await expect(page.locator(".chart-svg").last()).toBeVisible();

  // Verifica nessuna rottura layout su mobile dopo grafici/tabelle/documenti
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 4. Cartella di retrieval locale
  const tmpFolder = fs.mkdtempSync(path.join(os.tmpdir(), "indice-folder-"));
  try {
    fs.writeFileSync(
      path.join(tmpFolder, "Verbale_Test.txt"),
      "Clausola speciale retrieval_cartella_ok.",
      "utf-8",
    );
    await page
      .getByRole("button", { name: "Cartelle retrieval", exact: true })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: "Percorso cartella" })
      .fill(tmpFolder);
    await page
      .getByRole("button", { name: "Collega e indicizza cartella" })
      .click();
    await expect(page.locator(".folder-card")).toContainText("1 file indicizzati");
    await page.keyboard.press("Escape");
  } finally {
    fs.rmSync(tmpFolder, { recursive: true, force: true });
  }

  // 5. Creazione e cancellazione pratica e conversazione
  await page.getByRole("button", { name: "Pratiche", exact: true }).first().click();
  await page.getByPlaceholder("Nome della pratica").fill("Pratica Temporanea");
  await page.getByRole("button", { name: "Crea pratica" }).click();
  await expect(page.locator(".crumb")).toContainText("Pratica Temporanea");

  await page
    .getByRole("button", { name: "Elimina conversazione Nuova conversazione" })
    .click();
  await page
    .getByRole("button", { name: "Elimina conversazione", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Pratiche", exact: true }).first().click();
  await page
    .getByRole("button", { name: "Elimina pratica Pratica Temporanea" })
    .click();
  await page
    .getByRole("button", { name: "Elimina pratica", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".crumb")).toContainText("Fornitura Orione");
});
