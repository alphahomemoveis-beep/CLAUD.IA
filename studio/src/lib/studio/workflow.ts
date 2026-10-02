import { AppError } from "../errors";

/**
 * Etapas do fluxo criativo. A ordem é fixa:
 * briefing > conceitos > planejamento > aprovado > gerado.
 * "A IA propõe. O usuário escolhe. A IA executa. Nunca inverter essa ordem."
 */
export const STAGES = ["briefing", "conceitos", "planejamento", "aprovado", "gerado"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  briefing: "Briefing",
  conceitos: "Conceitos apresentados",
  planejamento: "Planejamento aguardando aprovação",
  aprovado: "Planejamento aprovado",
  gerado: "Imagens geradas",
};

export interface WorkflowState {
  stage: Stage;
  chosenConceptId: string | null;
  approvedPlanId: string | null;
}

export class WorkflowError extends AppError {
  constructor(message: string) {
    super(409, message, "fluxo_bloqueado");
  }
}

export function assertCanChooseConcept(s: WorkflowState) {
  if (s.stage === "briefing") throw new WorkflowError("Ainda não há conceitos para escolher.");
  if (s.stage === "aprovado" || s.stage === "gerado") {
    throw new WorkflowError("O planejamento já foi aprovado. Peça uma alteração para voltar ao planejamento.");
  }
}

export function assertCanApprovePlan(s: WorkflowState, hasPendingPlan: boolean) {
  if (!s.chosenConceptId) throw new WorkflowError("Escolha um conceito antes de aprovar um planejamento.");
  if (s.stage !== "planejamento" || !hasPendingPlan) throw new WorkflowError("Não há planejamento aguardando aprovação.");
}

/**
 * REGRA ABSOLUTA: nenhuma imagem é gerada sem conceito escolhido e
 * planejamento aprovado. Vale para qualquer rota que chame o modelo de imagem.
 */
export function assertCanGenerate(s: WorkflowState) {
  if (!s.chosenConceptId) {
    throw new WorkflowError("Regra absoluta: nenhuma imagem é gerada antes da escolha do conceito.");
  }
  if (!s.approvedPlanId || (s.stage !== "aprovado" && s.stage !== "gerado")) {
    throw new WorkflowError("Regra absoluta: nenhuma imagem é gerada antes da aprovação do planejamento.");
  }
}

export function nextStageAfterApproval(): Stage {
  return "aprovado";
}
