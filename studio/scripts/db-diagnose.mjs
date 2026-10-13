// Traduz um erro de conexão com o banco em uma orientação curta, sem expor
// a senha nem o endereço. Usado pelo migrador e pela rota /api/saude.
export function diagnoseDbError(err, url = process.env.DATABASE_URL ?? "") {
  const msg = String(err?.message ?? err ?? "");
  const code = String(err?.code ?? "");
  if (!url.trim()) {
    return "A variável DATABASE_URL está vazia na Railway. Cole nela o endereço do Session pooler do Supabase.";
  }
  if (/\[YOUR-PASSWORD\]/i.test(url)) {
    return "O DATABASE_URL ainda tem [YOUR-PASSWORD]. Troque pela senha do banco do Supabase, sem os colchetes.";
  }
  if (!/^postgres(ql)?:\/\//i.test(url.trim())) {
    return "O DATABASE_URL precisa começar com postgresql://. Copie de novo do Supabase (Connect > Direct > Session pooler).";
  }
  if (/password authentication failed/i.test(msg) || code === "28P01") {
    return "O Supabase recusou a senha que está no DATABASE_URL. Confira a senha (ou redefina em Project Settings > Database) e use só letras e números.";
  }
  if (/tenant or user not found/i.test(msg)) {
    return "O Supabase não reconheceu o usuário do DATABASE_URL. Copie de novo o endereço do Session pooler: o usuário é postgres.<código do projeto>.";
  }
  if (/certificate|self.signed|unable to verify|SSL|TLS/i.test(msg)) {
    return "Falhou a verificação do certificado do banco. Como último recurso, acrescente ?sslmode=no-verify ao fim do DATABASE_URL.";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "O endereço do banco no DATABASE_URL não existe. Copie de novo do Supabase (Connect > Direct > Session pooler).";
  }
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH" || /ENETUNREACH/.test(msg)) {
    return "O endereço direto do Supabase não funciona na Railway. Use o do Session pooler (Connect > Direct > Session pooler).";
  }
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || /timeout|terminated unexpectedly/i.test(msg)) {
    return "O banco não respondeu. Veja se o projeto do Supabase está pausado (Resume project) e tente de novo.";
  }
  return `O banco deu um erro ao conectar: ${msg.replace(/postgres(ql)?:\/\/\S+/gi, "[endereço]").slice(0, 200)}`;
}
