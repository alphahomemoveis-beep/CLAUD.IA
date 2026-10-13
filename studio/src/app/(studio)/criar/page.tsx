import { getSessionUser } from "@/lib/auth/session";
import { CriarHome } from "@/components/criar/CriarHome";

export default async function CriarPage() {
  const user = await getSessionUser();
  return <CriarHome canAct={user?.role === "owner" || user?.role === "editor"} />;
}
