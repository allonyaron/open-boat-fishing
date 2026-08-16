import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { requireMate } from "@/lib/mate-auth";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Used by the native mate app — accepts raw image body with Content-Type and X-Filename headers
export async function POST(req: NextRequest) {
  const auth = await requireMate(req);
  if (auth instanceof NextResponse) return auth;

  const contentType = req.headers.get("content-type") ?? "";
  const mimeType = contentType.split(";")[0].trim();
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 415 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 413 });
  }

  const filename = req.headers.get("x-filename") ?? `photo-${Date.now()}.jpg`;
  const pathname = `reports/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const blob = await put(pathname, req.body!, {
    access: "public",
    contentType: mimeType,
  });

  return NextResponse.json({ url: blob.url });
}
