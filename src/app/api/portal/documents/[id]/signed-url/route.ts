import { NextRequest } from "next/server";
import { signedDocumentUrlResponse } from "@/lib/document-signed-url-route";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return signedDocumentUrlResponse(request, id, "portal");
}
