"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { saveApplicationCorrectionResponse } from "@/app/apply/application/actions";
import {
  applicationCorrectionFieldLabel,
  type ApplicationCorrectionFieldKey
} from "@/lib/application-corrections";

const longTextFields = new Set<ApplicationCorrectionFieldKey>([
  "work_experience",
  "visa_notes",
  "pocus_previous_experience",
  "pocus_motivation",
  "pocus_case_improved_management",
  "pocus_limitations_case",
  "evidence_summary"
]);

const requiredFields = new Set<ApplicationCorrectionFieldKey>([
  "first_name",
  "last_name",
  "date_of_birth",
  "email",
  "phone",
  "address_line_1",
  "city",
  "postcode",
  "country",
  "clinical_role",
  "employer",
  "department_specialty",
  "professional_registration_body",
  "professional_registration_number",
  "highest_qualification",
  "qualification_awarding_body",
  "qualification_year",
  "work_experience",
  "nationality",
  "country_of_residence",
  "pocus_previous_experience",
  "pocus_motivation",
  "pocus_case_improved_management",
  "pocus_limitations_case"
]);

function initialInputValue(value: string | number | boolean | null): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return value === null ? "" : String(value);
}

function serializedValue(key: ApplicationCorrectionFieldKey, value: string): string {
  if (key === "needs_visa_check") return JSON.stringify(value === "true");
  if (key === "qualification_year") return JSON.stringify(Number(value));
  return JSON.stringify(value);
}

function CorrectionInput({
  fieldKey,
  value,
  onChange,
  disabled
}: {
  fieldKey: ApplicationCorrectionFieldKey;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const common = {
    id: `correction-${fieldKey}`,
    name: "corrected_value",
    className: "input",
    value,
    disabled,
    required: !disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(event.target.value)
  };

  if (fieldKey === "needs_visa_check") {
    return (
      <select {...common} className="select">
        <option value="false">No</option>
        <option value="true">Yes</option>
      </select>
    );
  }

  if (fieldKey === "funding_source") {
    return (
      <select {...common} className="select">
        <option value="unknown">Unknown</option>
        <option value="self_funded">Self-funded</option>
        <option value="employer_sponsor">Employer/sponsor</option>
        <option value="nhs_trust">NHS/trust</option>
        <option value="other">Other</option>
      </select>
    );
  }

  if (longTextFields.has(fieldKey)) {
    return <textarea {...common} className="textarea" rows={4} maxLength={10000} />;
  }

  const type = fieldKey === "date_of_birth"
    ? "date"
    : fieldKey === "qualification_year"
      ? "number"
      : fieldKey === "email"
        ? "email"
        : fieldKey === "phone"
          ? "tel"
          : "text";

  return (
    <input
      {...common}
      type={type}
      min={fieldKey === "qualification_year" ? 1900 : undefined}
      max={fieldKey === "qualification_year" ? 2100 : undefined}
      maxLength={fieldKey === "qualification_year" ? undefined : 10000}
    />
  );
}

export function ApplicationCorrectionFieldResponse({
  itemId,
  fieldKey,
  initialValue,
  initialCleared = false,
  responseNote
}: {
  itemId: string;
  fieldKey: ApplicationCorrectionFieldKey;
  initialValue: string | number | boolean | null;
  initialCleared?: boolean;
  responseNote?: string;
}) {
  const [value, setValue] = useState(initialInputValue(initialValue));
  const [clearValue, setClearValue] = useState(initialCleared);
  const canClear = !requiredFields.has(fieldKey);

  return (
    <form action={saveApplicationCorrectionResponse} className="application-correction-response-form">
      <input type="hidden" name="item_id" value={itemId} />
      {clearValue ? (
        <input type="hidden" name="clear_value" value="true" />
      ) : (
        <input type="hidden" name="proposed_value_json" value={serializedValue(fieldKey, value)} />
      )}
      <label htmlFor={`correction-${fieldKey}`}>
        <span>Corrected {applicationCorrectionFieldLabel(fieldKey).toLowerCase()}</span>
        <CorrectionInput fieldKey={fieldKey} value={value} onChange={setValue} disabled={clearValue} />
      </label>
      {canClear ? (
        <label className="check-option inline-check">
          <input type="checkbox" checked={clearValue} onChange={(event) => setClearValue(event.target.checked)} />
          Clear this value because it does not apply
        </label>
      ) : null}
      <label>
        <span>Note to admissions (optional)</span>
        <textarea className="textarea" name="response_note" rows={2} maxLength={2000} defaultValue={responseNote} />
      </label>
      <button className="button secondary" type="submit">
        <Save size={16} /> Save corrected information
      </button>
    </form>
  );
}
