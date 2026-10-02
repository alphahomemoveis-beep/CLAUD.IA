import { FolderBrowser } from "@/components/FolderBrowser";

export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FolderBrowser key={id} id={id} />;
}
