import { ChatView } from "@/components/chat/ChatView";

/** ✨ Novo projeto / ＋ Novo chat: conversa limpa, memória da marca intacta. */
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ novo?: string }> }) {
  const sp = await searchParams;
  return <ChatView key={sp.novo ?? "home"} />;
}
