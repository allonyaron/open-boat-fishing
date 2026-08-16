import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { requireMate } from "@/lib/mate-auth";
import { requireAdmin } from "@/lib/session";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  // Accept both mate JWT and admin iron-session
  const mateAuth = await requireMate(req.clone() as NextRequest);
  const adminAuth = !(mateAuth instanceof NextResponse) ? null : await requireAdmin(req);

  if (mateAuth instanceof NextResponse && adminAuth instanceof NextResponse) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        return {
          allowedContentTypes: ALLOWED_TYPES,
          maximumSizeInBytes: MAX_SIZE_BYTES,
          tokenPayload: pathname,
        };
      },
      onUploadCompleted: async () => {
        // URL recorded by the client after upload; nothing to do server-side here
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
