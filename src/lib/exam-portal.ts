import "server-only";

import { z } from "zod";

const examPortalPickerExamSchema = z.object({
  exam_id: z.string().min(1),
  exam_title: z.string().nullable().optional(),
  released: z.boolean().optional(),
  reviewed: z.boolean().optional(),
  available_for_lms: z.boolean().optional(),
  created_at: z.string().nullable().optional(),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  submissions_reviewed_at: z.string().nullable().optional(),
  result_count: z.number().int().nonnegative().optional(),
  token_count: z.number().int().nonnegative().optional()
});

const examPortalPickerResponseSchema = z.object({
  exams: z.array(examPortalPickerExamSchema).optional()
});

export interface ExamPortalPickerExam {
  examId: string;
  examTitle?: string;
  released: boolean;
  reviewed: boolean;
  availableForLms: boolean;
  createdAt?: string;
  startTime?: string;
  endTime?: string;
  submissionsReviewedAt?: string;
  resultCount: number;
  tokenCount: number;
}

function examPortalExamsEndpoint(): string | undefined {
  if (process.env.EXAM_PORTAL_LMS_EXAMS_URL) {
    return process.env.EXAM_PORTAL_LMS_EXAMS_URL;
  }

  return process.env.EXAM_PORTAL_LMS_RESULTS_URL?.replace(/\/lms-results\/?$/, "/lms-exams");
}

export async function getExamPortalPickerExams(search = ""): Promise<ExamPortalPickerExam[]> {
  const endpoint = examPortalExamsEndpoint();
  const secret = process.env.EXAM_PORTAL_LMS_API_SECRET;
  if (!endpoint || !secret) {
    return [];
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      reviewed_only: true,
      search,
      limit: 100
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Exam Portal exam picker failed with HTTP ${response.status}.`);
  }

  const parsed = examPortalPickerResponseSchema.parse(await response.json());
  return (parsed.exams ?? [])
    .map((exam) => ({
      examId: exam.exam_id,
      examTitle: exam.exam_title ?? undefined,
      released: exam.released ?? false,
      reviewed: exam.reviewed ?? Boolean(exam.submissions_reviewed_at),
      availableForLms: exam.available_for_lms ?? Boolean(exam.submissions_reviewed_at),
      createdAt: exam.created_at ?? undefined,
      startTime: exam.start_time ?? undefined,
      endTime: exam.end_time ?? undefined,
      submissionsReviewedAt: exam.submissions_reviewed_at ?? undefined,
      resultCount: exam.result_count ?? 0,
      tokenCount: exam.token_count ?? 0
    }))
    .filter((exam) => exam.availableForLms);
}
