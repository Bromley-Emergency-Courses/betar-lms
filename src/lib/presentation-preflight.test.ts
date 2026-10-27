import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { presentationRubricCriteria } from "./presentation-rubric";

const query = readFileSync(new URL("../../supabase/checks/presentation-preflight-legacy.sql", import.meta.url), "utf8");

describe("legacy presentation preflight", () => {
  it("screens the old schema without cancellation helpers or changing evidence", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        create table enrolments(id text primary key, student_id text, offering_id text);
        create table presentation_scores(id text primary key,student_id text,offering_id text,staff_user_id text,
          occurred_on date,presentation_type text,duration_minutes integer,scores jsonb,total_score numeric);
        insert into enrolments values ('enrolment','student','offering');
      `);
      const scores = Object.fromEntries(presentationRubricCriteria.map(criterion => [criterion.id, 4]));
      await database.query("insert into presentation_scores values ('score','student','offering','author','2026-01-01','journal_club',10,$1,40)", [JSON.stringify(scores)]);
      await database.query("insert into presentation_scores values ('discrepant','student','offering','other-author','2026-01-02',null,15,$1,39)", [JSON.stringify(scores)]);
      await database.exec("insert into presentation_scores values ('invalid','unowned','offering','author','2026-01-01','journal_club',10,'{}',20)");
      const before = await database.query("select * from presentation_scores order by id");
      const results = await database.exec(query);
      const report = JSON.parse((results[1].rows[0] as { report: string }).report);
      expect(report).toMatchObject({
        score_rows: 3, presentation_groups: 2, duplicate_author_groups: 0,
        scores_without_exactly_one_owner: 1, scores_on_cancelled_enrolments: null,
        conflicting_metadata_groups: 1, incomplete_metadata_groups: 1,
        invalid_rubrics: 1, legacy_total_differences: 1, unlinked_scores: 3
      });
      expect(report.cancellation_check).toContain("Not applicable");
      expect((await database.query("select * from presentation_scores order by id")).rows).toEqual(before.rows);
      expect((await database.query("select to_regprocedure('public.enrolment_is_cancelled(uuid)') as helper")).rows).toEqual([{ helper: null }]);
    } finally {
      await database.close();
    }
  });
});
