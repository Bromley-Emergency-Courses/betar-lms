import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase";
import { portalSignInPath, type PortalActorType } from "@/lib/portal-access";

export interface PortalPerson {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  email: string;
}

export interface PortalProfile {
  authUserId: string;
  personId: string;
  email: string;
  actorType: PortalActorType;
  person: PortalPerson;
}

type PortalPersonRow = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string;
};

type PortalIdentityRow = {
  person_id: string;
  email: string | null;
  actor_type: PortalActorType;
  persons: PortalPersonRow | PortalPersonRow[] | null;
};

function firstPersonRow(value: PortalIdentityRow["persons"]): PortalPersonRow | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value;
}

function mapPortalProfile(authUserId: string, row: PortalIdentityRow): PortalProfile | null {
  const person = firstPersonRow(row.persons);
  if (!person) {
    return null;
  }

  return {
    authUserId,
    personId: row.person_id,
    email: row.email ?? person.email,
    actorType: row.actor_type,
    person: {
      id: person.id,
      firstName: person.first_name,
      lastName: person.last_name,
      preferredName: person.preferred_name ?? undefined,
      email: person.email
    }
  };
}

export const getCurrentPortalProfile = cache(async (): Promise<PortalProfile | null> => {
  if (!isSupabaseConfigured()) {
    return {
      authUserId: "demo-portal-user",
      personId: "demo-person",
      email: "applicant@example.com",
      actorType: "applicant",
      person: {
        id: "demo-person",
        firstName: "Demo",
        lastName: "Applicant",
        email: "applicant@example.com"
      }
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data, error } = await supabase
    .from("person_auth_identities")
    .select(
      `
        person_id,
        email,
        actor_type,
        persons:person_id (
          id,
          first_name,
          last_name,
          preferred_name,
          email
        )
      `
    )
    .eq("auth_user_id", user.id)
    .eq("active", true)
    .maybeSingle<PortalIdentityRow>();

  if (error || !data) {
    return null;
  }

  return mapPortalProfile(user.id, data);
});

export async function requireCurrentPortalProfile(next?: string | null): Promise<PortalProfile> {
  const profile = await getCurrentPortalProfile();
  if (!profile) {
    redirect(portalSignInPath(next));
  }
  return profile;
}

export async function requirePortalActor(
  allowedActorTypes: PortalActorType[],
  next?: string | null
): Promise<PortalProfile> {
  const profile = await requireCurrentPortalProfile(next);
  if (!allowedActorTypes.includes(profile.actorType)) {
    redirect("/portal");
  }
  return profile;
}

export async function requireApplicantProfile(next?: string | null): Promise<PortalProfile> {
  return requirePortalActor(["applicant"], next);
}

export async function requireStudentProfile(next?: string | null): Promise<PortalProfile> {
  return requirePortalActor(["student"], next);
}
