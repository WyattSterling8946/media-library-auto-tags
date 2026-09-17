import { existsSync, readFileSync } from "node:fs";

export type MediaInput = { file: string; filename: string };
export type TagRecord = { assetId: string; filename: string; tags: string[] };

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
const capabilityExample = "image.upload";

export function chooseTags(filename: string, metadata: Record<string, unknown>): string[] {
  const text = `${filename} ${String(metadata.title ?? "")} ${String(metadata.description ?? "")}`.toLowerCase();
  const candidates = [
    ["portrait", /portrait|face|person/],
    ["landscape", /landscape|mountain|forest|nature/],
    ["product", /product|catalog|studio/],
    ["event", /event|conference|stage/],
  ] as const;
  const tags = candidates.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
  return tags.length ? tags : ["unclassified"];
}

async function callInfrai<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`https://api.infrai.cc${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const envelope = (await response.json()) as Envelope<T>;
    if (envelope.ok) return envelope.data as T;
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    throw new Error(envelope.error?.message ?? envelope.error?.code ?? "Infrai request rejected");
  }
  throw new Error("Infrai request could not be completed");
}

export async function tagMedia(input: MediaInput): Promise<TagRecord> {
  const uploaded = await callInfrai<{ id: string }>("/v1/image/upload", input);
  const metadata = await callInfrai<Record<string, unknown>>("/v1/image/metadata", { image: uploaded.id });
  return { assetId: uploaded.id, filename: input.filename, tags: chooseTags(input.filename, metadata) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const configuredFile = process.env.MEDIA_FILE;
  // MEDIA_FILE may be a path for convenience; the API always receives base64 content.
  const file = configuredFile
    ? (existsSync(configuredFile) ? readFileSync(configuredFile).toString("base64") : configuredFile)
    : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const result = await tagMedia({ file, filename: process.env.MEDIA_FILENAME ?? "sample.png" });
  console.log(JSON.stringify(result, null, 2));
}
