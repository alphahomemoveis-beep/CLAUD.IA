import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { startRender } from "@/lib/criar/produce";

/** Monta as artes ou o vídeo da opção escolhida, com os fundos e a logo. */
export const POST = route<{ id: string }>(async ({ user, params }) => {
  await startRender(await getBrand(), user.id, params.id);
  return json({ ok: true }, 202);
}, { role: "editor", rate: "image" });
