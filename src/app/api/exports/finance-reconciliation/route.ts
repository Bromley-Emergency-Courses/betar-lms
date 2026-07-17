import { NextResponse } from "next/server";
import { getLmsData } from "@/lib/lms-data";
import { financeDiscrepancy } from "@/lib/rules";
import { rowsToCsv } from "@/lib/exports";

export async function GET() {
  const data = await getLmsData();
  const rows = [
    [
      "Student ID",
      "Student Name",
      "Term",
      "Expected Amount Pence",
      "Invoice Status",
      "Invoice Amount Pence",
      "Payment Status",
      "Paid Amount Pence",
      "Balance Due Pence",
      "Notes"
    ],
    ...data.financeRecords.flatMap((record) => {
      const student = data.students.find((candidate) => candidate.id === record.studentId);
      const term = data.terms.find((candidate) => candidate.id === record.termId);
      if (!student || !term) {
        return [];
      }
      return [
        [
          student.cccuStudentId ?? student.temporaryId,
          `${student.firstName} ${student.lastName}`,
          term.name,
          String(record.expectedAmountPence),
          record.invoiceStatus,
          String(record.invoiceAmountPence ?? ""),
          record.paymentStatus,
          String(record.paidAmountPence ?? ""),
          String(financeDiscrepancy(record)),
          record.notes ?? ""
        ]
      ];
    })
  ];

  return new NextResponse(rowsToCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="finance-reconciliation.csv"'
    }
  });
}
