import "server-only";
import type { EmbeddingProvider } from "./types";

/** Embeddings pelo Voyage AI, parceiro recomendado pela Anthropic. */
export class VoyageEmbeddings implements EmbeddingProvider {
  readonly name = "voyage";
  constructor(private apiKey: string, readonly model: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: texts, model: this.model }),
    });
    if (!res.ok) throw new Error(`Voyage AI recusou o pedido de embeddings (${res.status})`);
    const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
