function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  imessageUrl: process.env.IMESSAGE_API_URL || "https://imessage.velroi.com",
  imessageKey: required("IMESSAGE_API_KEY"),
  openaiKey: required("OPENAI_API_KEY"),
  model: process.env.OPENAI_AGENT_MODEL || "gpt-6-astra",
  voiceMcpUrl: required("VOICE_MCP_URL"),
  /** Rank + clearing price. Agent still sends the SMS. */
  marketMakerUrl: (process.env.MARKET_MAKER_URL || "http://localhost:3000").replace(/\/$/, ""),

  /** Only these numbers get answered. Empty means answer every enrolled sender. */
  allowedNumbers: (process.env.ALLOWED_NUMBERS || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean),

  /**
   * Where someone finishes their profile: photo, what work they will take,
   * and the consent for using their likeness in generated media. The agent
   * hands this out, so it must never be a guess - an unreachable link is
   * worse than saying nothing.
   */
  signupUrl: (process.env.SIGNUP_URL || "https://gotchu-web-production.up.railway.app/onboarding").replace(/\/$/, ""),

  /** Unset until the voice agent is live - the agent must not invent a number. */
  voiceCallNumber: process.env.VOICE_CALL_NUMBER || "",

  maxReplyChars: 320,
  /** Hard cap on stored turns per person, counting tool actions. */
  historyTurns: 100,
  maxToolIterations: 4,
  /** Let the person answer for themselves before their agent acts. */
  negotiationGraceMs: 45_000,
  pollSeconds: 3,
  port: Number(process.env.PORT || 3000),
};
