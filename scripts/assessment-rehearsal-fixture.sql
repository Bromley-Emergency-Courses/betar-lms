begin;
insert into auth.users(id,email) values ('49000000-0000-4000-8000-000000000001','assessment-admin@example.test');
insert into public.staff_profiles(id,full_name,role) values ('49000000-0000-4000-8000-000000000001','Synthetic Assessment Admin','admin');
select set_config('request.jwt.claim.sub','49000000-0000-4000-8000-000000000001',false);
insert into public.students(id,temporary_id,first_name,last_name,email,programme,status) values
  ('49000000-0000-4000-8000-000000000002','ASSESSMENT-001','Synthetic','Learner','learner@example.test','pgcert','active');
insert into public.terms(id,name,starts_on,ends_on) values
  ('49000000-0000-4000-8000-000000000003','Synthetic teaching cohort','2025-01-01','2025-05-31'),
  ('49000000-0000-4000-8000-000000000004','Synthetic later sitting','2025-09-01','2025-12-31');
insert into public.course_modules(id,code,title,mode) values
  ('49000000-0000-4000-8000-000000000005','SYN-MCQ','Synthetic MCQ','online'),
  ('49000000-0000-4000-8000-000000000006','SYN-PRACTICAL','Synthetic practical','practical'),
  ('49000000-0000-4000-8000-000000000007','SYN-CW','Synthetic Coursework/Viva','online');
select public.save_module_assessment_plan('{"module_id":"49000000-0000-4000-8000-000000000005","theory_scheme":"mcq","theory_pass_mark":50,"reason":"Synthetic reviewed plan"}',null);
select public.save_module_assessment_plan('{"module_id":"49000000-0000-4000-8000-000000000006","theory_scheme":"mcq","theory_pass_mark":50,"practical_pass_mark":50,"reason":"Synthetic reviewed plan"}',null);
select public.save_module_assessment_plan('{"module_id":"49000000-0000-4000-8000-000000000007","theory_scheme":"coursework_viva","requires_coursework":true,"requires_viva":true,"theory_pass_mark":50,"reason":"Synthetic reviewed plan"}',null);
insert into public.module_offerings(id,module_id,term_id,price_pence,capacity) values
  ('49000000-0000-4000-8000-000000000008','49000000-0000-4000-8000-000000000005','49000000-0000-4000-8000-000000000003',0,20),
  ('49000000-0000-4000-8000-000000000009','49000000-0000-4000-8000-000000000006','49000000-0000-4000-8000-000000000003',0,20),
  ('49000000-0000-4000-8000-000000000010','49000000-0000-4000-8000-000000000007','49000000-0000-4000-8000-000000000003',0,20),
  ('49000000-0000-4000-8000-000000000011','49000000-0000-4000-8000-000000000007','49000000-0000-4000-8000-000000000004',0,20);
insert into public.enrolments(id,student_id,offering_id,status,final_mark,grade,credits_awarded) values
  ('49000000-0000-4000-8000-000000000012','49000000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000008','completed',null,null,10),
  ('49000000-0000-4000-8000-000000000013','49000000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000009','failed',null,null,0),
  ('49000000-0000-4000-8000-000000000014','49000000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000010','deferred',72,'Legacy',10),
  ('49000000-0000-4000-8000-000000000015','49000000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000011','resit',null,null,0);
insert into public.exam_results(id,student_id,offering_id,component_type,source_system,source_attempt_id,score,pass_mark,passed,resit_required,taken_on,is_resit,attempt_number,prior_attempt_missing) values
  ('49000000-0000-4000-8000-000000000016','49000000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000008','theory','theory_portal','synthetic-portal-1',70,50,true,false,'2025-05-20',false,1,false),
  ('49000000-0000-4000-8000-000000000017','49000000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000009','practical','practical_osce','synthetic-csv-1',30,50,false,true,'2025-05-20',false,1,false),
  ('49000000-0000-4000-8000-000000000018','49000000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000010','theory','manual','synthetic-manual-1',72,50,true,false,'2025-05-20',false,1,false),
  ('49000000-0000-4000-8000-000000000019','49000000-0000-4000-8000-000000000002','49000000-0000-4000-8000-000000000011','theory','theory_portal','synthetic-portal-2',45,50,false,true,'2025-10-01',true,2,true);
insert into public.students(id,temporary_id,first_name,last_name,email,programme,status)
select ('49000000-0000-4000-8000-' || lpad(identifier::text,12,'0'))::uuid, 'REHEARSAL-' || identifier, 'Synthetic', 'Legacy ' || identifier, 'legacy-' || identifier || '@example.test', 'pgcert', 'active'
from generate_series(20,24) identifier;
insert into public.enrolments(id,student_id,offering_id,status)
select ('49000000-0000-4000-8000-' || lpad((identifier+10)::text,12,'0'))::uuid,
  ('49000000-0000-4000-8000-' || lpad(identifier::text,12,'0'))::uuid,
  case when identifier=23 then '49000000-0000-4000-8000-000000000009'::uuid else '49000000-0000-4000-8000-000000000008'::uuid end,
  state::public.enrolment_status
from (values (20,'planned'),(21,'in_progress'),(22,'did_not_complete'),(23,'failed'),(24,'failed')) fixture(identifier,state);
insert into public.exam_results(id,student_id,offering_id,component_type,source_system,source_attempt_id,score,pass_mark,passed,resit_required,taken_on,is_resit,attempt_number,prior_attempt_missing) values
  ('49000000-0000-4000-8000-000000000040','49000000-0000-4000-8000-000000000023','49000000-0000-4000-8000-000000000009','practical','manual','synthetic-manual-practical',35,50,false,true,'2025-05-20',false,1,false),
  ('49000000-0000-4000-8000-000000000041','49000000-0000-4000-8000-000000000024','49000000-0000-4000-8000-000000000008','theory','theory_portal','synthetic-duplicate-1',35,50,false,true,'2025-05-20',false,1,false),
  ('49000000-0000-4000-8000-000000000042','49000000-0000-4000-8000-000000000024','49000000-0000-4000-8000-000000000008','theory','theory_portal','synthetic-duplicate-2',45,50,false,true,'2025-05-20',false,1,false);
commit;
