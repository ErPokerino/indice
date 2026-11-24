export type Source = {
  id: number;
  doc: number;
  name: string;
  label: string;
  page: number | null;
  quote: string;
  rects: number[][];
  visual: boolean;
};

export type Doc = {
  id: number;
  name: string;
  mime: string;
  pages: number;
  visualPages: number[];
  folderId?: number | null;
  folderLabel?: string | null;
  relPath?: string | null;
  folderEnabled?: boolean;
};

export type Folder = {
  id: number;
  matter: number;
  label: string;
  path: string;
  recursive: boolean;
  enabled: boolean;
  lastSync: string | null;
  fileCount: number;
  exists: boolean;
};

export type Meter = { used: number; limit: number; estimated: boolean };

export type TemplateAttr = { key: string; value: string };

export type TemplateExample = {
  id: number;
  name: string;
  mime?: string | null;
  notes: string;
  preview: string;
  length: number;
};

export type Template = {
  id: number;
  version: number;
  name: string;
  purpose: string;
  sections: string;
  fields: string;
  instructions: string;
  category: string;
  tone: string;
  audience: string;
  jurisdiction: string;
  output_format: string;
  clause_rules: string;
  custom_attrs: TemplateAttr[];
  examples?: TemplateExample[];
  examplesCount?: number;
};

export type RichTableData = {
  title: string;
  description?: string;
  columns: string[];
  rows: string[][];
};

export type ChartDatum = {
  label: string;
  value: number;
  date?: string;
  note?: string;
  category?: string;
};

export type ChartData = {
  title: string;
  subtitle?: string;
  type: "bar" | "horizontal_bar" | "line" | "donut" | "timeline";
  unit?: string;
  data: ChartDatum[];
};

export type CompiledDocument = {
  title: string;
  templateName?: string;
  content: string;
  compiledFields?: { field: string; value: string }[];
  missingFields?: string[];
};

export type PlanStep = {
  strategy: string;
  query: string;
  docFilter?: string;
  reason: string;
  hits: number;
};

export type Turn = {
  id: number;
  question: string;
  text: string;
  sources: Source[];
  trace: string[];
  plan?: PlanStep[];
  skills?: string[];
  configVersion: number;
  template?: Template;
  model: string | null;
  level: string;
  mode: "example" | "local" | "gemini";
  meter?: Meter;
  tables?: RichTableData[];
  charts?: ChartData[];
  document?: CompiledDocument;
};

export type Session = {
  id: number;
  matter: number;
  title: string;
  model: string;
  level: string;
  revision: number;
  selected: number[];
  docs: Doc[];
  folders?: Folder[];
  turns: Turn[];
};

export type Config = {
  version: number;
  prompt: string;
  model: string;
  level: string;
  tools: string[];
  semantic: boolean;
};

export type ApiKeyStatus = {
  configured: boolean;
  source: "app" | "env" | "dotenv" | "none";
  masked: string;
};

export type MatterSummary = {
  id: number;
  name: string;
  docCount?: number;
  sessionCount?: number;
  folderCount?: number;
};

export type AgentBlueprint = {
  tools: { id: string; name: string; category: string; desc: string }[];
  skills: { id: string; name: string; trigger: string; desc: string }[];
};

export type Studio = {
  matters: MatterSummary[];
  sessions: { id: number; matter: number; title: string }[];
  settings: Config;
  templates: Template[];
  online: boolean;
  apiKey: ApiKeyStatus;
  models: Record<string, string>;
  levels: Record<string, string>;
  tools: Record<string, string>;
  agentBlueprint?: AgentBlueprint;
};

export async function api<T>(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const form = body instanceof FormData;
  const res = await fetch("/api" + url, {
    method,
    headers: body && !form ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Richiesta non riuscita (" + res.status + ").",
    );
  }
  return res.json();
}

export const err = (e: unknown) =>
  e instanceof Error ? e.message : "Operazione non riuscita.";

export const fmt = (n: number) => n.toLocaleString("it-IT");

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, mime = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([text], { type: mime }), filename);
}
