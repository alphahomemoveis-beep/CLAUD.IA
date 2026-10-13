import { getSessionUser } from "@/lib/auth/session";
import { CreationView } from "@/components/criar/CreationView";

export default async function CriacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([getSessionUser(), params]);
  return <CreationView id={id} role={user?.role ?? "viewer"} />;
}
