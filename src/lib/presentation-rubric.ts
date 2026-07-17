export interface PresentationRubricCriterion {
  id: string;
  label: string;
}

export interface PresentationRubricGroup {
  name: string;
  criteria: PresentationRubricCriterion[];
}

export const presentationRubricGroups: PresentationRubricGroup[] = [
  {
    name: "Content",
    criteria: [
      {
        id: "content_material_accurate_up_to_date",
        label: "Material is accurate and up to date"
      },
      {
        id: "content_questions_encouraged_handled_well",
        label: "Questions are encouraged and handled well"
      },
      {
        id: "content_reference_slide_key_papers",
        label: "Reference slide includes 3–5 key papers"
      },
      {
        id: "content_critical_reflection",
        label: "Evidence of critical reflection on the topic"
      },
      {
        id: "content_title_slide_details",
        label: "Title slide includes name, module, topic and date"
      }
    ]
  },
  {
    name: "Delivery",
    criteria: [
      {
        id: "delivery_engages_audience",
        label: "Actively engages the audience"
      },
      {
        id: "delivery_clear_audible_pace",
        label: "Clear, audible and appropriate pace"
      }
    ]
  },
  {
    name: "Organisation",
    criteria: [
      {
        id: "organisation_logical_sequence",
        label: "Information is presented in a logical sequence"
      },
      {
        id: "organisation_slides_prepared_effective",
        label: "Slides are well prepared, informative, effective, not distracting; images/videos incorporated"
      }
    ]
  },
  {
    name: "Global impression",
    criteria: [
      {
        id: "global_impression_information_communicated_well",
        label: "Good information was communicated well"
      }
    ]
  }
];

export const presentationRubricCriteria = presentationRubricGroups.flatMap((group) => group.criteria);
