import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { folderPaths } from "@/lib/repo/folders";

/** Todas as pastas com o caminho completo, para seletores. */
export const GET = route(async () => json({ folders: await folderPaths((await getBrand()).id) }));
