/**
 * The card sent when something has been sitting unanswered. It is deliberately
 * loud - a flashing red X and a warning sign - because it only goes out after a
 * plain text has already failed to move the thing.
 *
 * The consequence stated here is real: after the final notice the offer is
 * cancelled and goes to somebody else. Do not write a threat the system will
 * not carry out.
 */
export type Nudge = {
  name?: string | null;
  reason: string;
  about: string;
  callingAbout: string;
  minutesWaiting: number;
  strike: number;
  finalNotice: boolean;
};

const CONSEQUENCE: Record<string, string> = {
  offer_unanswered:
    "If you don't reply, this job is cancelled and offered to someone else.",
  counter_undecided:
    "If you don't reply, the counter-offer expires and your task stays unclaimed.",
  question_unanswered:
    "Someone can't start the job until you answer, and they may well give up on it.",
};

export function buildNudgeHtml(n: Nudge): string {
  const who = n.name ? `${n.name}, ` : "";
  const heading = n.finalNotice ? "FINAL NOTICE" : "REPLY NEEDED";
  const consequence = CONSEQUENCE[n.reason] ?? "Please reply so this can move.";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading} - Gotchu</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: #140806; color: #FFE9E4;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    padding: 24px;
  }
  .card {
    max-width: 34rem; width: 100%; text-align: center;
    border: 2px solid #B3321E; border-radius: 14px;
    background: #1E0C09; padding: 32px 24px;
    box-shadow: 0 0 0 6px rgba(179,50,30,.18);
  }
  .marks { display: flex; gap: 18px; justify-content: center; align-items: center; }
  .x {
    font-size: 84px; line-height: 1; font-weight: 800; color: #FF3B25;
    animation: flash 900ms steps(1, end) infinite;
  }
  .warn { font-size: 66px; line-height: 1; animation: pulse 900ms ease-in-out infinite; }
  @keyframes flash { 0%, 49% { opacity: 1; } 50%, 100% { opacity: .12; } }
  @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.14); } }
  @media (prefers-reduced-motion: reduce) {
    .x, .warn { animation: none; }
    .x { opacity: 1; }
  }
  h1 {
    margin: 18px 0 6px; font-size: 1.9rem; letter-spacing: .14em;
    color: #FF5B45; text-transform: uppercase;
  }
  .waited { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: .82rem; letter-spacing: .1em; color: #C9897C; }
  .about { margin: 20px 0 8px; font-size: 1.12rem; line-height: 1.5; }
  .consequence {
    margin-top: 18px; padding-top: 16px; border-top: 1px solid #4A1C14;
    font-size: 1rem; color: #FFC9BE;
  }
  .how { margin-top: 14px; font-size: .92rem; color: #C9897C; }
</style></head>
<body>
  <div class="card">
    <div class="marks"><div class="x">&#10006;</div><div class="warn">&#9888;&#65039;</div></div>
    <h1>${heading}</h1>
    <div class="waited">WAITING ${n.minutesWaiting} MINUTES &middot; NOTICE ${n.strike}</div>
    <p class="about">${who}${escapeHtml(n.callingAbout)}</p>
    <p class="consequence">${consequence}</p>
    <p class="how">Just reply to this message. A yes, a no, or an answer is enough.</p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
