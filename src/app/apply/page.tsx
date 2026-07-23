import { CheckCircle2 } from "lucide-react";
import { Field, FormGrid } from "@/components/forms";
import { submitPublicEnquiry } from "@/app/apply/actions";

export default async function ApplyPage({
  searchParams
}: {
  searchParams: Promise<{ submitted?: string; demo?: string }>;
}) {
  const { submitted, demo } = await searchParams;
  const isSubmitted = submitted === "1";

  return (
    <main className="apply-page">
      <section className="apply-intake">
        <div className="apply-heading">
          <div className="brand-mark">B</div>
          <div>
            <span className="apply-kicker">BETAR PGCert POCUS</span>
            <h1>Enquire about studying with BETAR</h1>
            <p>Send your details to the admissions team. This is an enquiry only, not a full application or student registration.</p>
          </div>
        </div>

        {isSubmitted ? (
          <div className="apply-success" role="status">
            <CheckCircle2 size={22} />
            <div>
              <h2>Enquiry received</h2>
              <p>
                The admissions team will review your enquiry and contact you with the next step.
                {demo === "1" ? " Demo mode is running without a Supabase database, so no live record was saved." : ""}
              </p>
            </div>
          </div>
        ) : (
          <form className="apply-form-panel" action={submitPublicEnquiry}>
            <FormGrid>
              <Field label="First name" htmlFor="apply-first-name">
                <input id="apply-first-name" name="first_name" className="input" autoComplete="given-name" required />
              </Field>
              <Field label="Last name" htmlFor="apply-last-name">
                <input id="apply-last-name" name="last_name" className="input" autoComplete="family-name" required />
              </Field>
              <Field label="Email" htmlFor="apply-email">
                <input id="apply-email" name="email" className="input" type="email" autoComplete="email" required />
              </Field>
              <Field label="Phone" htmlFor="apply-phone">
                <input id="apply-phone" name="phone" className="input" type="tel" autoComplete="tel" />
              </Field>
              <Field label="Programme interest" htmlFor="apply-programme">
                <select id="apply-programme" name="programme" className="select" defaultValue="pgcert">
                  <option value="pgcert">PGCert</option>
                  <option value="microcredential">Microcredential</option>
                </select>
              </Field>
            </FormGrid>
            <Field label="Message" htmlFor="apply-notes">
              <textarea
                id="apply-notes"
                name="notes"
                className="textarea"
                placeholder="Optional: tell us about your clinical role, intended start timing, or questions for admissions."
              />
            </Field>
            <button className="button primary apply-submit">Send enquiry</button>
          </form>
        )}
      </section>
    </main>
  );
}
