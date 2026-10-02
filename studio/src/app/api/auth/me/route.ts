import { json, route } from "@/lib/api";

export const GET = route(async ({ user }) => json({ user }));
