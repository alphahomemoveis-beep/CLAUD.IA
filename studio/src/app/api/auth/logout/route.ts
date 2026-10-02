import { NextResponse, type NextRequest } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/api";
import { errorResponse } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
