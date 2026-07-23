import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  createSignedDocumentUrl,
  SignedDocumentUrlError,
  type SignedDocumentUrlOptions
} from "@/lib/document-signed-urls";
import type { SignedDocumentAccessBoundary } from "@/lib/document-access";

interface SignedUrlRequestBody {
  expiresInSeconds?: unknown;
  download?: unknown;
}

async function requestedOptions(request: NextRequest): Promise<SignedDocumentUrlOptions> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  const body = (await request.json().catch(() => null)) as SignedUrlRequestBody | null;
  return {
    expiresInSeconds: typeof body?.expiresInSeconds === "number" ? body.expiresInSeconds : undefined,
    download: typeof body?.download === "boolean" ? body.download : undefined
  };
}

export async function signedDocumentUrlResponse(
  request: NextRequest,
  fileId: string,
  boundary: SignedDocumentAccessBoundary
) {
  try {
    return NextResponse.json(await createSignedDocumentUrl(fileId, boundary, await requestedOptions(request)));
  } catch (error) {
    if (error instanceof SignedDocumentUrlError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }

    throw error;
  }
}
