# BETAR LMS

Terms used to describe a student's module enrolment and its assessments.

## Language

**Module Enrolment**:
A student's participation in one scheduled delivery of a module. A later assessment-only sitting remains part of the original enrolment; repeating the teaching creates a new enrolment.
_Avoid_: Exam enrolment, resit enrolment

**Enrolment Added in Error**:
A Module Enrolment created by mistake and cancelled as an administrative correction, rather than a record of the student withdrawing. It is excluded from normal participation and academic calculations while its original record and cancellation history remain available for audit.
_Avoid_: Abandoned, deleted enrolment

**Abandoned Module**:
A genuine Module Enrolment from which the student has withdrawn. It remains part of the student's academic record rather than being treated as an enrolment that should never have existed.
_Avoid_: Enrolment Added in Error

**Assessment Component**:
One required part of a module assessment: Theory or Practical. A theory-only module has no Practical component rather than a missing Practical result.
_Avoid_: Overall component

**Assessment Item**:
A scored part, such as an MCQ, Viva, Coursework, or physics/equipment assessment, recorded in support of an Assessment Component's score. An Assessment Item does not independently determine pass or fail.
_Avoid_: Assessment Component

**Module Assessment Plan**:
The module-level definition of its required Assessment Items and how they produce its Assessment Component scores. Every Module Enrolment inherits the plan unless an audited individual exception applies.
_Avoid_: Student score-entry options

**MCQ Theory Assessment**:
A Theory assessment whose Theory Score is the MCQ score, unless configured physics/equipment weighting produces the score from equal MCQ and physics/equipment contributions.

**Coursework/Viva Theory Assessment**:
A Theory assessment with no MCQ. Its Module Assessment Plan requires Coursework, Viva, or both supporting scores, and its authoritative combined Theory Score is supplied rather than calculated by the LMS.

**Online Module**:
A module requiring a Theory Assessment Component but no Practical Assessment Component or practical-attendance requirement. Its Practical result is `N/A`.

**Practical Module**:
A module requiring both Theory and Practical Assessment Components together with the applicable practical-attendance requirements.

**Theory Score**:
The percentage used to determine the outcome of a Theory attempt. It is the MCQ score for a simple MCQ assessment, the calculated 50/50 result where physics/equipment contributes, or an independently supplied combined score for a Coursework/Viva assessment; the LMS does not calculate the Coursework/Viva combined score.
_Avoid_: Overall score

**Practical Score**:
The percentage recorded for a Practical attempt. `N/A` means the module has no Practical component; it does not mean that a required score is missing.

**Assessment Attempt**:
A completed sitting of one Assessment Component for which a score is recorded. A correction does not create another attempt, and a deferred or scheduled assessment is not an attempt until it is completed and scored.
_Avoid_: Assessment booking, correction

**Assessment Correction**:
A reasoned administrator revision to a Manual result that preserves the Assessment Attempt's identity and retains immutable before/after history. Imported source values are not corrected in the LMS; an incorrect import is unmatched and replaced manually.
_Avoid_: Resit

**Current Component Result**:
The latest valid Assessment Attempt for an Assessment Component. Earlier attempts remain part of the component's history.
_Avoid_: Best result

**Enrolment Status**:
The single primary state of a Module Enrolment: `Planned`, `In progress`, `Abandoned`, `Pass`, `Fail`, `Module deferred`, or `Assessment deferred`. It is normally calculated from the enrolment's current facts using the agreed precedence rules.
_Avoid_: Overall outcome, Resit status

**Enrolment Indicator**:
A calculated label explaining an Enrolment Status: `Resit required`, `Resit scheduled`, `Attendance non-compliance`, or `Presentation incomplete`. Multiple indicators may apply, and attendance or presentation failures remain visibly distinct from failed assessment scores.
_Avoid_: Enrolment Status

**Status Override**:
An audited administrator decision replacing a calculated Enrolment Status or Enrolment Indicator. It requires a reason and remains active until explicitly cleared while the LMS continues to show its calculated recommendation.

**Awarded Credits**:
The module's configured credits granted when an enrolment has `Pass` status. Every other status grants zero unless an administrator records an audited exceptional override.

**Current Academic Risk**:
An active failed assessment, scheduled or required resit, attendance non-compliance, or incomplete presentation. A resolved historical failure is not Current Academic Risk; assessment and module deferrals and abandoned enrolments are reported separately.

**Resit Required**:
The student has a failed Assessment Component without a later passing attempt. It does not mean that another sitting has been arranged.

**Resit Scheduled**:
A future sitting arranged for a failed Assessment Component, with a compulsory administrator note recording when it is scheduled. It remains part of the original Module Enrolment and is not yet an Assessment Attempt; cancellation returns it to Resit Required.
_Avoid_: Resit completed

**Resit**:
A new Assessment Attempt for an Assessment Component whose current result is failed. A passed component is retained and is not resat merely to improve its score; a Coursework/Viva Theory resit identifies new and carried-forward supporting scores while recording a new supplied combined Theory Score.
_Avoid_: Correction, deferred assessment

**Assessment Deferred**:
The teaching has been completed but one Assessment Component has been postponed. It does not create a failed score or an Assessment Attempt, and another component may already be complete.
_Avoid_: Module Deferred

**Previous Result Unavailable**:
An audited exception used when a sitting is known to be a resit but its earlier result is absent from the LMS. It records a reason or reference without inventing the missing score or an unsupported attempt number.

**Ambiguous Assessment Result**:
An imported result for which the LMS cannot identify exactly one owning Module Enrolment. It remains unattached until an administrator selects the enrolment rather than being assigned from the assessment sitting term alone.

**Source Identity Override**:
An audited administrator decision matching an Imported Result to a student whose LMS identity differs from the identity supplied by the source. The original source identity remains unchanged and the override requires a reason.

**Matched Imported Result**:
An imported assessment result attached to exactly one Module Enrolment. Its source identity and imported values remain available even if an administrator later corrects or reassigns it.

**Unmatched Imported Result**:
An imported assessment result retained in the Exams register without an owning Module Enrolment. An administrator may match it later or leave it unmatched because its source value is wrong; unmatching a result does not delete or edit its source record.
_Avoid_: Deleted result

**Manual Replacement Result**:
A manually entered result that supplies the accepted score for the same sitting as an unmatched incorrect Imported Result. It is explicitly linked to the import, shares its sitting and attempt sequence, and moves the import to `Replaced manually`; it is not a resit.
_Avoid_: Corrected imported result, new attempt

**Voided Result**:
A duplicate or wholly invalid result excluded from outcomes and exports without being deleted. It remains visible with its voiding reason, administrator, and timestamp and may be restored by an administrator.
_Avoid_: Deleted result

**Module Deferred**:
The module's teaching has been postponed. It is distinct from postponing only an assessment.
_Avoid_: Assessment Deferred

**Presentation**:
One case presentation or journal club delivered by a student for one Module Enrolment, distinct from another module's presentation even on the same day. Several staff may assess the same Presentation; their separate scores do not represent additional presentations.
_Avoid_: Presentation Score

**Presentation Score**:
One assessor's rubric scores, feedback and any manual time-penalty deduction for a Presentation. Only that assessor may revise their submission; a revision does not create another Presentation or an Assessment Attempt.

**Presentation Plan**:
An intention for a student to present for a particular Module Enrolment on a teaching date. It is not evidence that the Presentation occurred and does not itself plan attendance.

**Attendance Plan**:
An expectation that a student will attend a teaching session in a term, independently of any Presentation Plan. It is not completed attendance or evidence that the student is currently present.
