/** Formatos da tela Criar conteúdo. Sem dependências: serve à tela e ao servidor. */
export const FORMATS = ["reels", "feed", "story", "roteiro", "carrossel"] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_INFO: Record<Format, { label: string; desc: string; pecas: [number, number]; ratio: "4:5" | "9:16" | null }> = {
  reels: { label: "Reels", desc: "Vídeo vertical montado com as imagens, mais o roteiro para gravar", pecas: [4, 9], ratio: "9:16" },
  feed: { label: "Post do feed", desc: "Uma arte 4:5 com título, texto e a assinatura da marca", pecas: [1, 1], ratio: "4:5" },
  story: { label: "Story", desc: "De 1 a 3 telas verticais 9:16", pecas: [1, 3], ratio: "9:16" },
  roteiro: { label: "Roteiro de vídeo", desc: "Roteiro completo para a apresentadora gravar, cena por cena", pecas: [4, 10], ratio: null },
  carrossel: { label: "Carrossel", desc: "De 4 a 8 artes 4:5, uma por página", pecas: [4, 8], ratio: "4:5" },
};
