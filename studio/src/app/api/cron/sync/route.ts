import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { errorResponse } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { syncMetricool, syncPostStatuses, syncWindsor } from "@/lib/journal/service";

export const maxDuration = 300;

/**
 * Sincronização agendada (ex.: Vercel Cron a cada hora). Exige
 * Authorization: Bearer CRON_SECRET.
 */
async function handler(req: NextRequest) {
  try {
    const secret = env().CRON_SECRET;
    const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const ok = !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
    if (!ok) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    const brand = await getBrand();
    const [windsor, metricool, posts] = await Promise.all([syncWindsor(brand, 14), syncMetricool(brand, 14), syncPostStatuses(brand)]);
    return NextResponse.json({ windsor, metricool, posts });
  } catch (err) {
    return errorResponse(err);
  }
}

export const GET = handler;
export const POST = handler;
