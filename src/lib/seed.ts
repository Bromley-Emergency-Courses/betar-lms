import type { AppData } from "@/lib/types";

export const appData: AppData = {
  admissionLeads: [],
  staffUsers: [
    {
      id: "user-admin-1",
      name: "Dr Aisha Rahman",
      email: "aisha.rahman@betar.example",
      role: "admin",
      active: true
    },
    {
      id: "user-teacher-1",
      name: "Mark Ellison",
      email: "mark.ellison@betar.example",
      role: "teacher",
      active: true
    },
    {
      id: "user-reception-1",
      name: "Reception Tablet",
      email: "reception@betar.example",
      role: "reception",
      active: true
    }
  ],
  students: [
    {
      id: "student-1",
      cccuStudentId: "CCCU240184",
      temporaryId: "BETAR-TMP-1001",
      firstName: "Nadia",
      lastName: "Patel",
      email: "nadia.patel@example.nhs.uk",
      phone: "07700 900101",
      status: "active",
      admissionStage: "cccu_registration_complete",
      programme: "pgcert",
      startTermId: "term-2026-jan",
      notes: "Prefers weekday teaching dates."
    },
    {
      id: "student-2",
      cccuStudentId: "CCCU240211",
      temporaryId: "BETAR-TMP-1002",
      firstName: "Oliver",
      lastName: "Hughes",
      email: "oliver.hughes@example.nhs.uk",
      status: "active",
      admissionStage: "cccu_registration_complete",
      programme: "pgcert",
      startTermId: "term-2026-jan"
    },
    {
      id: "student-3",
      temporaryId: "BETAR-TMP-1003",
      firstName: "Priya",
      lastName: "Shah",
      email: "priya.shah@example.nhs.uk",
      phone: "07700 900103",
      status: "prospect",
      admissionStage: "cccu_registration_pending",
      programme: "microcredential"
    },
    {
      id: "student-4",
      temporaryId: "BETAR-TMP-1004",
      firstName: "James",
      lastName: "Morgan",
      email: "james.morgan@example.nhs.uk",
      status: "deferred",
      admissionStage: "accepted",
      programme: "pgcert",
      startTermId: "term-2025-sep"
    }
  ],
  terms: [
    {
      id: "term-2026-jan",
      name: "January-March 2026",
      startsOn: "2026-01-05",
      endsOn: "2026-03-20",
      examWindowStartsOn: "2026-03-23",
      examWindowEndsOn: "2026-03-27",
      status: "closed"
    },
    {
      id: "term-2026-apr",
      name: "April-June 2026",
      startsOn: "2026-04-13",
      endsOn: "2026-06-26",
      examWindowStartsOn: "2026-06-29",
      examWindowEndsOn: "2026-07-03",
      status: "active"
    },
    {
      id: "term-2026-sep",
      name: "September-November 2026",
      startsOn: "2026-09-07",
      endsOn: "2026-11-20",
      status: "published"
    }
  ],
  modules: [
    {
      id: "module-core",
      code: "POCUS-CORE",
      title: "Foundations of Point of Care Ultrasound",
      credits: 10,
      mode: "online",
      mandatory: true,
      active: true
    },
    {
      id: "module-cardiac",
      code: "POCUS-CARD",
      title: "Focused Cardiac Ultrasound",
      credits: 10,
      mode: "practical",
      mandatory: false,
      active: true
    },
    {
      id: "module-lung",
      code: "POCUS-LUNG",
      title: "Lung and Pleural Ultrasound",
      credits: 10,
      mode: "practical",
      mandatory: false,
      active: true
    },
    {
      id: "module-vascular",
      code: "POCUS-VASC",
      title: "Vascular Access Ultrasound",
      credits: 10,
      mode: "practical",
      mandatory: false,
      active: true
    }
  ],
  offerings: [
    {
      id: "offering-core-apr",
      moduleId: "module-core",
      termId: "term-2026-apr",
      pricePence: 90000,
      capacity: 40,
      attendanceDaysRequiredFirstPractical: 0,
      attendanceDaysRequiredSubsequentPractical: 0,
      presentationRequired: false
    },
    {
      id: "offering-cardiac-apr",
      moduleId: "module-cardiac",
      termId: "term-2026-apr",
      pricePence: 90000,
      capacity: 18,
      attendanceDaysRequiredFirstPractical: 3,
      attendanceDaysRequiredSubsequentPractical: 2,
      presentationRequired: true
    },
    {
      id: "offering-lung-apr",
      moduleId: "module-lung",
      termId: "term-2026-apr",
      pricePence: 90000,
      capacity: 18,
      attendanceDaysRequiredFirstPractical: 3,
      attendanceDaysRequiredSubsequentPractical: 2,
      presentationRequired: true
    },
    {
      id: "offering-vascular-sep",
      moduleId: "module-vascular",
      termId: "term-2026-sep",
      pricePence: 90000,
      capacity: 16,
      attendanceDaysRequiredFirstPractical: 3,
      attendanceDaysRequiredSubsequentPractical: 2,
      presentationRequired: true
    }
  ],
  enrolments: [
    {
      id: "enrolment-1",
      studentId: "student-1",
      offeringId: "offering-core-apr",
      status: "completed",
      grade: "Pass",
      finalMark: 68,
      creditsAwarded: 10
    },
    {
      id: "enrolment-2",
      studentId: "student-1",
      offeringId: "offering-cardiac-apr",
      status: "in_progress",
      creditsAwarded: 0
    },
    {
      id: "enrolment-3",
      studentId: "student-2",
      offeringId: "offering-cardiac-apr",
      status: "in_progress",
      creditsAwarded: 0
    },
    {
      id: "enrolment-4",
      studentId: "student-2",
      offeringId: "offering-lung-apr",
      status: "in_progress",
      creditsAwarded: 0
    }
  ],
  sessions: [
    {
      id: "session-card-1",
      termId: "term-2026-apr",
      sessionDate: "2026-05-04",
      startsAt: "09:00",
      endsAt: "17:00",
      location: "BETAR Skills Lab 1",
      expectedStudentIds: ["student-1", "student-2"]
    },
    {
      id: "session-card-2",
      termId: "term-2026-apr",
      sessionDate: "2026-05-05",
      startsAt: "09:00",
      endsAt: "17:00",
      location: "BETAR Skills Lab 1",
      expectedStudentIds: ["student-1", "student-2"]
    },
    {
      id: "session-lung-1",
      termId: "term-2026-apr",
      sessionDate: "2026-05-12",
      startsAt: "09:00",
      endsAt: "17:00",
      location: "BETAR Skills Lab 2",
      expectedStudentIds: ["student-2"]
    }
  ],
  attendance: [
    {
      id: "attendance-1",
      sessionId: "session-card-1",
      studentId: "student-1",
      status: "attended",
      checkedInAt: "2026-05-04T08:52:00.000Z",
      checkedOutAt: "2026-05-04T16:58:00.000Z",
      recordedByUserId: "user-reception-1"
    },
    {
      id: "attendance-2",
      sessionId: "session-card-1",
      studentId: "student-2",
      status: "attended",
      checkedInAt: "2026-05-04T08:55:00.000Z",
      checkedOutAt: "2026-05-04T16:48:00.000Z",
      recordedByUserId: "user-reception-1"
    },
    {
      id: "attendance-3",
      sessionId: "session-card-2",
      studentId: "student-1",
      status: "attended",
      checkedInAt: "2026-05-05T08:51:00.000Z",
      checkedOutAt: "2026-05-05T17:02:00.000Z",
      recordedByUserId: "user-reception-1"
    }
  ],
  assessmentDefinitions: [
    {
      id: "assessment-cardiac-measurements",
      moduleId: "module-cardiac",
      name: "Focused Cardiac Measurements",
      active: true,
      scoreMin: 0,
      scoreMax: 10,
      domains: [
        { id: "image_quality", label: "Image quality" },
        { id: "measurement_accuracy", label: "Measurement accuracy" },
        { id: "interpretation", label: "Clinical interpretation" }
      ]
    },
    {
      id: "assessment-lung-protocol",
      moduleId: "module-lung",
      name: "Lung Scanning Protocol",
      active: true,
      scoreMin: 0,
      scoreMax: 10,
      domains: [
        { id: "probe_selection", label: "Probe selection" },
        { id: "systematic_scan", label: "Systematic scan" },
        { id: "pathology_recognition", label: "Pathology recognition" }
      ]
    }
  ],
  encounters: [
    {
      id: "encounter-1",
      studentId: "student-1",
      offeringId: "offering-cardiac-apr",
      staffUserId: "user-teacher-1",
      occurredOn: "2026-05-04",
      summary: "Good acquisition technique. Needs more confidence verbalising differential findings.",
      concernLevel: "watch"
    },
    {
      id: "encounter-2",
      studentId: "student-2",
      offeringId: "offering-cardiac-apr",
      staffUserId: "user-teacher-1",
      occurredOn: "2026-05-04",
      summary: "Strong practical session and prepared for supervised practice.",
      concernLevel: "none"
    }
  ],
  assessmentAttempts: [
    {
      id: "attempt-1",
      studentId: "student-1",
      offeringId: "offering-cardiac-apr",
      definitionId: "assessment-cardiac-measurements",
      staffUserId: "user-teacher-1",
      occurredOn: "2026-05-04",
      assessedItemIds: ["image_quality", "measurement_accuracy", "interpretation"],
      overallScore: 7,
      scores: {},
      comments: "Repeat LVOT measurement next session."
    }
  ],
  presentationScores: [
    {
      id: "presentation-1",
      studentId: "student-2",
      offeringId: "offering-cardiac-apr",
      staffUserId: "user-teacher-1",
      occurredOn: "2026-05-05",
      presentationType: "case_presentation",
      durationMinutes: 20,
      scores: {
        content_material_accurate_up_to_date: 4,
        content_questions_encouraged_handled_well: 4,
        content_reference_slide_key_papers: 3,
        content_critical_reflection: 4,
        content_title_slide_details: 5,
        delivery_engages_audience: 5,
        delivery_clear_audible_pace: 5,
        organisation_logical_sequence: 4,
        organisation_slides_prepared_effective: 4,
        global_impression_information_communicated_well: 4
      },
      totalScore: 42,
      comments: "Clear presentation with good clinical framing."
    }
  ],
  financeRecords: [
    {
      id: "finance-1",
      studentId: "student-1",
      termId: "term-2026-apr",
      expectedAmountPence: 180000,
      invoiceStatus: "sent",
      invoiceAmountPence: 180000,
      paymentStatus: "paid",
      paidAmountPence: 180000
    },
    {
      id: "finance-2",
      studentId: "student-2",
      termId: "term-2026-apr",
      expectedAmountPence: 180000,
      invoiceStatus: "sent",
      invoiceAmountPence: 90000,
      paymentStatus: "outstanding",
      notes: "Only one module appears on CCCU invoice."
    },
    {
      id: "finance-3",
      studentId: "student-3",
      termId: "term-2026-sep",
      expectedAmountPence: 90000,
      invoiceStatus: "not_requested",
      paymentStatus: "not_due"
    }
  ],
  examPortalMappings: [],
  examPortalSubmissions: [],
  managedFiles: [],
  examResults: [
    {
      id: "exam-1",
      studentId: "student-1",
      offeringId: "offering-core-apr",
      componentType: "theory",
      sourceSystem: "theory_portal",
      sourceAttemptId: "theory-2026-core-184",
      score: 68,
      passMark: 50,
      passed: true,
      resitRequired: false,
      isResit: false,
      attemptNumber: 1,
      priorAttemptMissing: false,
      takenOn: "2026-06-29",
      importedAt: "2026-07-01T09:00:00.000Z"
    },
    {
      id: "exam-2",
      studentId: "student-2",
      offeringId: "offering-cardiac-apr",
      componentType: "practical",
      sourceSystem: "practical_osce",
      sourceAttemptId: "osce-2026-card-211",
      score: 46,
      passMark: 50,
      passed: false,
      resitRequired: true,
      isResit: false,
      attemptNumber: 1,
      priorAttemptMissing: false,
      takenOn: "2026-06-30",
      importedAt: "2026-07-01T09:05:00.000Z"
    }
  ]
};

export function getAppData(): AppData {
  return appData;
}
