// Início em produção: aplica as migrações e liga o app. Se o banco falhar, o
// app liga mesmo assim e a tela de login mostra o que corrigir, em vez de a
// hospedagem só dizer "Healthcheck failure".
import { spawn } from "node:child_process";

function run(cmd, args, env, capture) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env, stdio: capture ? ["ignore", "inherit", "pipe"] : "inherit" });
    let err = "";
    if (capture) p.stderr.on("data", (d) => { err += String(d); process.stderr.write(d); });
    p.on("close", (code) => resolve({ code: code ?? 1, err }));
    p.on("error", (e) => resolve({ code: 1, err: String(e) }));
  });
}

const migrate = await run(process.execPath, ["scripts/migrate.mjs"], process.env, true);
const env = { ...process.env };
if (migrate.code !== 0) {
  const line = migrate.err.split("\n").find((l) => l.startsWith("DIAGNOSTICO: "));
  env.DB_STARTUP_ERROR = line ? line.slice("DIAGNOSTICO: ".length).trim() : "As migrações do banco falharam. Veja o log do deploy.";
  console.error(`Banco indisponível: ${env.DB_STARTUP_ERROR} O app vai ligar para mostrar o aviso.`);
}
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start"], { env, stdio: "inherit" });
// A hospedagem encerra o processo principal; repassa para o app fechar direito.
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => next.kill(sig));
next.on("close", (code) => process.exit(code ?? 0));
