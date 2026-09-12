/**
 * @owner Daphne
 * Distilled Carnegie Mellon Student Handbook ("The Word") + Academic Integrity Policy.
 * Use this to decide BLOCK vs ALLOW. Do not paste the full handbook (copyright).
 *
 * Sources (public):
 * https://www.cmu.edu/student-affairs/theword/
 * https://www.cmu.edu/policies/student-and-student-life/academic-integrity.html
 * https://www.cmu.edu/student-affairs/theword/community-standards/community-standards-violations.html
 */

export const HANDBOOK_SOURCE_URLS = {
  theWord: "https://www.cmu.edu/student-affairs/theword/",
  academicIntegrity:
    "https://www.cmu.edu/policies/student-and-student-life/academic-integrity.html",
  communityStandards:
    "https://www.cmu.edu/student-affairs/theword/community-standards/community-standards-violations.html",
} as const;

/** Compact policy the gate/arbitration prompts read. */
export const CMU_HANDBOOK_POLICY = `You are applying Carnegie Mellon's Student Handbook ("The Word") and the University Policy on Academic Integrity to a student-to-student task marketplace.

Academic credit must represent that student's own work. Collaboration or assistance on graded work is not allowed unless the instructor explicitly authorizes it. That includes cheating, plagiarism, and unauthorized assistance — e.g. paying someone to write a lab, take an exam, sit as a proxy, share answer keys, or complete a problem set.

The Word also treats as misconduct (non-exhaustive):
- Misrepresentation of self or another person; altering or misusing university documents; providing false information to a university official
- Possession or use of false identification; unauthorized possession or use of keys or access cards
- Alcohol and drug policy violations; deadly weapons policy violations
- Theft, fraud, assault, harassment, hazing, endangering others, threats of violence
- Unauthorized assistance / academic integrity violations listed above

Gotchu-specific applications of those rules:
- BLOCK paying someone to do graded work (unauthorized assistance). Tutoring that only explains concepts may be ALLOW_WITH_CONDITIONS.
- BLOCK package pickup and any task that needs another student's ID, dining card, or access credential (false ID / misrepresentation / unauthorized access cards).
- BLOCK buying, picking up, or delivering alcohol, tobacco, or controlled substances. Age does not matter — even if everyone is 21 or older, alcohol is banned on Gotchu. Never ALLOW_WITH_CONDITIONS for alcohol.
- BLOCK weapons, real physical danger, illegal work, harassment.
- BLOCK paying in anything except US dollars. No coffee, pizza, dining swipes, or favors mixed in — even if there is also a dollar price. You cannot bargain anything other than money. Venmo/Zelle/cash are fine.
- Price (how many dollars) is not a handbook issue. There is no dollar cap. The medium of payment must be money.
- Ordinary campus help (food run, moving a box, painting a fence, event setup) is ALLOW unless it trips a rule above.

If unsure whether graded work is being done *for* the student, BLOCK. Never treat “they’re 21” as permission for alcohol. Cite the handbook category in one sentence to the student, not a legal brief.`;

export const HANDBOOK_REASONS: Record<string, string> = {
  academic_integrity:
    "Blocked under CMU's Academic Integrity Policy (The Word): graded work must be your own — paying someone to do a lab, exam, or assignment is unauthorized assistance.",
  credential_misuse:
    "Blocked under The Word: misrepresentation, false identification, or using someone else's ID / access credential is not allowed. Package pickup would require the recipient's ID.",
  controlled_substances:
    "Alcohol is not allowed on Gotchu at any age — including delivery or pickup when everyone is 21+. Blocked under The Word (Alcohol and Drug Policy).",
  physical_safety:
    "Blocked under The Word (welfare / deadly weapons): this task could put someone at risk of harm.",
  financial_risk:
    "Gotchu only allows bargaining money (USD). You cannot add coffee, food, swipes, or favors — even on top of a dollar price.",
  illegal:
    "Blocked under The Word (theft, fraud, or other illegal conduct): this task isn't allowed on Gotchu.",
  harassment:
    "Blocked under The Word (welfare of others): harassment, threats, or similar conduct is not allowed.",
};
