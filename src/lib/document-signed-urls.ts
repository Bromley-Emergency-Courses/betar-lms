import "server-only";

import {
  canAccessManagedDocument,
  requiresStaffDocumentAccessAudit,
  signedDocumentDownloadFilename,
  type DocumentAccessActor,
  type ManagedFileAccessRow,
  type SignedDocumentAccessBoundary
} from "@/lib/document-access";
import { createSupabaseServiceRoleClient, isSupabaseServiceRoleConfigured } from "@/lib/supabase-admin";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import type { ManagedFileRetentionClass, UserRole } from "@/lib/types";

const signedUrlDefaultExpiresInSeconds = 300;
const signedUrlMaxExpiresInSeconds = 900;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SignedDocumentUrlError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SignedDocumentUrlError";
  }
}

interface StaffProfileRow {
  id: string;
  role: UserRole;
  active: boolean;
}

interface PortalIdentityRow {
  person_id: string;
  actor_type: "applicant" | "student";
  active: boolean;
}

interface ManagedFileRow {
  id: string;
  student_id: string | null;
  person_id: string | null;
  bucket: string;
  object_path: string;
  label: string;
  original_filename: string | null;
  sanitized_filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  retention_class: ManagedFileRetentionClass | null;
}

export interface SignedDocumentUrlResult {
  signedUrl: string;
  expiresInSeconds: number;
  expiresAt: string;
  file: {
    id: string;
    label: string;
    bucket: string;
    contentType?: string;
    sizeBytes?: number;
    filename: string;
    retentionClass: ManagedFileRetentionClass;
  };
}

export interface SignedDocumentUrlOptions {
  expiresInSeconds?: number;
  download?: boolean;
}

function normalizeExpiresInSeconds(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return signedUrlDefaultExpiresInSeconds;
  }

  return Math.max(1, Math.min(Math.floor(value), signedUrlMaxExpiresInSeconds));
}

function mapManagedFileRow(row: ManagedFileRow): ManagedFileAccessRow {
  return {
    id: row.id,
    studentId: row.student_id ?? undefined,
    personId: row.person_id ?? undefined,
    bucket: row.bucket,
    objectPath: row.object_path,
    label: row.label,
    originalFilename: row.original_filename ?? undefined,
    sanitizedFilename: row.sanitized_filename ?? undefined,
    contentType: row.content_type ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    retentionClass: row.retention_class ?? "student_academic_record"
  };
}

async function resolveActor(boundary: SignedDocumentAccessBoundary): Promise<DocumentAccessActor> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new SignedDocumentUrlError(401, "unauthenticated", "Authentication is required.");
  }

  if (boundary === "staff") {
    const { data: staffProfile, error } = await supabase
      .from("staff_profiles")
      .select("id, role, active")
      .eq("id", user.id)
      .eq("active", true)
      .maybeSingle<StaffProfileRow>();

    if (error) {
      throw new SignedDocumentUrlError(500, "staff_lookup_failed", error.message);
    }

    if (!staffProfile) {
      throw new SignedDocumentUrlError(403, "staff_required", "An active staff account is required.");
    }

    return {
      kind: "staff",
      userId: user.id,
      role: staffProfile.role
    };
  }

  const { data: portalIdentity, error } = await supabase
    .from("person_auth_identities")
    .select("person_id, actor_type, active")
    .eq("auth_user_id", user.id)
    .eq("active", true)
    .maybeSingle<PortalIdentityRow>();

  if (error) {
    throw new SignedDocumentUrlError(500, "portal_identity_lookup_failed", error.message);
  }

  if (!portalIdentity) {
    throw new SignedDocumentUrlError(403, "portal_identity_required", "An active portal identity is required.");
  }

  return {
    kind: "portal",
    userId: user.id,
    personId: portalIdentity.person_id,
    actorType: portalIdentity.actor_type
  };
}

async function loadAuthorizedManagedFile(fileId: string, actor: DocumentAccessActor): Promise<ManagedFileAccessRow> {
  const supabase = await createSupabaseServerClient();
  const { data: fileRow, error } = await supabase
    .from("managed_files")
    .select(
      "id, student_id, person_id, bucket, object_path, label, original_filename, sanitized_filename, content_type, size_bytes, retention_class"
    )
    .eq("id", fileId)
    .maybeSingle<ManagedFileRow>();

  if (error) {
    throw new SignedDocumentUrlError(500, "document_lookup_failed", error.message);
  }

  if (!fileRow) {
    throw new SignedDocumentUrlError(404, "document_not_found", "Document was not found.");
  }

  const file = mapManagedFileRow(fileRow);
  const decision = canAccessManagedDocument(actor, file);
  if (!decision.allowed) {
    throw new SignedDocumentUrlError(403, "document_forbidden", "Document access is not permitted.");
  }

  return file;
}

async function auditStaffDocumentAccess(actor: DocumentAccessActor, file: ManagedFileAccessRow, expiresInSeconds: number) {
  if (!requiresStaffDocumentAccessAudit(actor, file)) {
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("audit_events").insert({
    actor_type: "staff",
    actor_user_id: actor.userId,
    actor_person_id: null,
    action: "document.signed_url_requested",
    entity_type: "managed_file",
    entity_id: file.id,
    reason: null,
    metadata: {
      bucket: file.bucket,
      retention_class: file.retentionClass,
      person_id: file.personId ?? null,
      student_id: file.studentId ?? null,
      expires_in_seconds: expiresInSeconds
    }
  });

  if (error) {
    throw new SignedDocumentUrlError(500, "document_access_audit_failed", error.message);
  }
}

export async function createSignedDocumentUrl(
  fileId: string,
  boundary: SignedDocumentAccessBoundary,
  options: SignedDocumentUrlOptions = {}
): Promise<SignedDocumentUrlResult> {
  if (!isSupabaseConfigured() || !isSupabaseServiceRoleConfigured()) {
    throw new SignedDocumentUrlError(503, "supabase_not_configured", "Supabase document signing is not configured.");
  }

  if (!uuidPattern.test(fileId)) {
    throw new SignedDocumentUrlError(400, "invalid_document_id", "Document ID must be a UUID.");
  }

  const actor = await resolveActor(boundary);
  const file = await loadAuthorizedManagedFile(fileId, actor);
  const expiresInSeconds = normalizeExpiresInSeconds(options.expiresInSeconds);
  await auditStaffDocumentAccess(actor, file, expiresInSeconds);

  const supabaseAdmin = createSupabaseServiceRoleClient();
  const signedUrlOptions = options.download ? { download: signedDocumentDownloadFilename(file) } : undefined;
  const { data, error } = await supabaseAdmin.storage.from(file.bucket).createSignedUrl(file.objectPath, expiresInSeconds, signedUrlOptions);

  if (error || !data?.signedUrl) {
    throw new SignedDocumentUrlError(
      404,
      "document_object_not_found",
      error?.message ?? "Document object could not be signed."
    );
  }

  return {
    signedUrl: data.signedUrl,
    expiresInSeconds,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    file: {
      id: file.id,
      label: file.label,
      bucket: file.bucket,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      filename: signedDocumentDownloadFilename(file),
      retentionClass: file.retentionClass
    }
  };
}
