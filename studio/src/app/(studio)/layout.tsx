import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Sidebar } from "@/components/Sidebar";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <div className="shell">
      <Sidebar user={user} />
      <main className="main">{children}</main>
    </div>
  );
}
