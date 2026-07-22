import { NextRequest, NextResponse } from "next/server";

const templates: Record<string, string> = {
  students:
    "temporary_id,cccu_student_id,first_name,last_name,email,phone,status,admission_stage,programme,start_term_name,notes\nBETAR-TMP-1001,CCCU240184,Nadia,Patel,nadia.patel@example.nhs.uk,07700900101,active,cccu_registration_complete,pgcert,April 2026,\n",
  enrolments:
    "student_identifier,module_code,term_name,status,final_mark,grade,credits_awarded,attendance_days_required_override,presentation_required_override\nCCCU240184,POCUS-CORE,April 2026,completed,68,Pass,10,,\nCCCU240185,POCUS-CARD,April 2026,resit,45,Resit,0,0,false\nCCCU240186,POCUS-LUNG,April 2026,did_not_complete,,,0,2,true\n",
  finance:
    "student_identifier,term_name,expected_amount,invoice_status,invoice_amount,payment_status,paid_amount,notes\nCCCU240184,April 2026,1800,sent,1800,paid,1800,\n",
  attendance:
    "student_identifier,module_code,term_name,session_date,status,checked_in_at,checked_out_at\nCCCU240184,POCUS-CARD,April 2026,2026-05-04,attended,2026-05-04T08:52:00Z,2026-05-04T16:58:00Z\n"
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ template: string }> }) {
  const { template } = await params;
  const csv = templates[template];
  if (!csv) {
    return NextResponse.json({ error: "template_not_found" }, { status: 404 });
  }

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${template}-template.csv"`
    }
  });
}
