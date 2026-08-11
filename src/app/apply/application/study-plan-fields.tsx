"use client";

import { useMemo, useState } from "react";
import { Field, FormGrid } from "@/components/forms";

export interface ApplicationTermOption {
  id: string;
  name: string;
  startsOn: string;
}

export interface ApplicationOfferingOption {
  id: string;
  termId: string;
  moduleCode: string;
  moduleTitle: string;
  credits: number;
  mode: "practical" | "online";
  capacity: number;
}

export function StudyPlanFields({
  programme,
  intendedStartTermId,
  selectedOfferingIds,
  terms,
  offerings
}: {
  programme: "pgcert" | "microcredential";
  intendedStartTermId: string | null;
  selectedOfferingIds: string[];
  terms: ApplicationTermOption[];
  offerings: ApplicationOfferingOption[];
}) {
  const [selectedProgramme, setSelectedProgramme] = useState(programme);
  const [selectedTermId, setSelectedTermId] = useState(intendedStartTermId ?? "");
  const [selectedIds, setSelectedIds] = useState(selectedOfferingIds);

  const termOfferings = useMemo(
    () => offerings.filter((offering) => offering.termId === selectedTermId),
    [offerings, selectedTermId]
  );
  const canSelectOfferings = selectedProgramme.length > 0 && selectedTermId.length > 0;
  const maxSelected = selectedIds.length >= 2;

  function updateOffering(offeringId: string, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(offeringId) || current.length >= 2 ? current : [...current, offeringId];
      }

      return current.filter((selectedId) => selectedId !== offeringId);
    });
  }

  return (
    <div className="application-section">
      <div className="application-section-heading">
        <h3>Intended Study Plan</h3>
        <span>{selectedIds.length > 0 ? "Started" : "Required before submission"}</span>
      </div>
      <FormGrid>
        <Field label="Programme choice" htmlFor="application-programme" required>
          <select
            id="application-programme"
            name="programme"
            className="select"
            value={selectedProgramme}
            onChange={(event) => {
              setSelectedProgramme(event.target.value as "pgcert" | "microcredential");
              setSelectedIds([]);
            }}
          >
            <option value="pgcert">PGCert</option>
            <option value="microcredential">Microcredential</option>
          </select>
        </Field>
        <Field label="Intended start term" htmlFor="application-start-term" required>
          <select
            id="application-start-term"
            name="intended_start_term_id"
            className="select"
            required
            value={selectedTermId}
            onChange={(event) => {
              setSelectedTermId(event.target.value);
              setSelectedIds([]);
            }}
          >
            <option value="">Select a term</option>
            {terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name} · starts {new Date(term.startsOn).toLocaleDateString("en-GB")}
              </option>
            ))}
          </select>
        </Field>
      </FormGrid>

      <fieldset className="checkbox-fieldset">
        <legend>First-term module offerings <span className="required-marker" aria-label="required">*</span></legend>
        {!canSelectOfferings ? (
          <p className="muted small">Choose a programme and intended start term to select module offerings.</p>
        ) : termOfferings.length === 0 ? (
          <p className="muted small">No selectable offerings are published for this term.</p>
        ) : (
          <div className="checkbox-list compact application-offering-list">
            {termOfferings.map((offering) => {
              const checked = selectedIds.includes(offering.id);
              return (
                <label className="check-option" key={offering.id}>
                  <input
                    name="selected_module_offering_ids"
                    type="checkbox"
                    value={offering.id}
                    checked={checked}
                    disabled={!checked && maxSelected}
                    required={selectedIds.length === 0}
                    onChange={(event) => updateOffering(offering.id, event.target.checked)}
                  />
                  <span>
                    <strong>{offering.moduleCode}</strong> · {offering.moduleTitle}
                    <small>
                      {offering.credits} credits · {offering.mode} · capacity {offering.capacity}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
    </div>
  );
}
