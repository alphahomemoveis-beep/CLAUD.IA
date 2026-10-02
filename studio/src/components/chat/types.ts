export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  kind: string;
  content: string;
  payload: Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  created_at: string;
}

export interface ChatImage {
  id: string;
  slide_number: number;
  slide_role: string;
  version: number;
  prompt: string;
  quality_review: { passed: boolean; attempts: number; checklist: Array<{ item: string; aprovado: boolean; observacao: string }>; resumo_da_mudanca?: string } | null;
  status: "pendente" | "gerando" | "pronta" | "falhou";
  error: string | null;
  model: string | null;
  size: string | null;
  has_file: boolean;
  verdict: "aprovada" | "rejeitada" | "alteracao" | null;
  favorite: boolean;
  revision_of: string | null;
  generated_at: string | null;
}

export interface ChatProject {
  id: string;
  title: string;
  content_type: string;
  stage: string;
  status: string;
  current_version: number;
  chosen_concept_id: string | null;
}

export interface PlanStatus { id: string; version: number; approved: boolean }

export type Action =
  | { type: "message"; text: string }
  | { type: "choose_concept"; conceptId: string }
  | { type: "approve_plan"; planId: string }
  | { type: "revise_plan"; notes: string }
  | { type: "regenerate_concepts"; notes: string };
