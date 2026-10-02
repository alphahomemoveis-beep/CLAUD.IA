import { getSessionUser } from "@/lib/auth/session";
import { AgendaView } from "@/components/agenda/AgendaView";

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ midia?: string }> }) {
  const [user, sp] = await Promise.all([getSessionUser(), searchParams]);
  const midia = sp.midia && /^[0-9a-f-]{36}$/.test(sp.midia) ? sp.midia : null;
  return <AgendaView canAct={user?.role === "owner" || user?.role === "editor"} initialMedia={midia} />;
}
