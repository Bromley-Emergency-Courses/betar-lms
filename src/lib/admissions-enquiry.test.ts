import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPublicEnquiryAuditMetadata,
  parsePublicEnquiryForm,
  publicEnquirySubmittedAction
} from "@/lib/admissions-enquiry";

function enquiryForm(overrides: Record<string, string | string[]> = {}): FormData {
  const formData = new FormData();
  const values: Record<string, string | string[]> = {
    first_name: " Nadia ",
    last_name: " Patel ",
    email: " NADIA.PATEL@EXAMPLE.NHS.UK ",
    phone: " 07700900101 ",
    programme: "pgcert",
    notes: "Interested in the next intake.",
    ...overrides
  };

  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => formData.append(key, entry));
    } else {
      formData.append(key, value);
    }
  }

  return formData;
}

describe("public admissions enquiry intake", () => {
  it("normalizes the public form without creating full application fields", () => {
    expect(
      parsePublicEnquiryForm(
        enquiryForm({
          module_interest_ids: ["b8a2cfcd-22d8-461d-882f-4db0ee6d0f1e"]
        })
      )
    ).toEqual({
      first_name: "Nadia",
      last_name: "Patel",
      email: "nadia.patel@example.nhs.uk",
      phone: "07700900101",
      programme: "pgcert",
      module_interest_ids: ["b8a2cfcd-22d8-461d-882f-4db0ee6d0f1e"],
      notes: "Interested in the next intake."
    });
  });

  it("keeps optional public enquiry fields nullable", () => {
    expect(
      parsePublicEnquiryForm(
        enquiryForm({
          phone: "",
          programme: "",
          notes: ""
        })
      )
    ).toMatchObject({
      phone: null,
      programme: "pgcert",
      notes: null
    });
  });

  it("builds the enquiry submission audit metadata without contact details", () => {
    expect(
      buildPublicEnquiryAuditMetadata({
        leadId: "7dd2e8be-7523-4210-8959-384289eb6325",
        programme: "microcredential",
        moduleInterestIds: ["b8a2cfcd-22d8-461d-882f-4db0ee6d0f1e"],
        source: "public_apply"
      })
    ).toEqual({
      programme: "microcredential",
      module_interest_count: 1,
      source: "public_apply"
    });
  });

  it("limits anonymous database access to the public intake RPC", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/0019_public_admission_enquiry_intake.sql"),
      "utf8"
    );

    expect(migration).toContain("grant execute on function public.submit_public_admission_enquiry");
    expect(migration).toContain("to anon, authenticated");
    expect(migration).toContain(`'${publicEnquirySubmittedAction}'`);
    expect(migration).not.toMatch(/create policy .*admission_leads/is);
  });
});
