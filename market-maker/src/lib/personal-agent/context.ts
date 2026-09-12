import { personalAgentContextSchema } from "@/lib/market/schemas";
import type { PersonalAgentContext, User } from "@/lib/market/types";

/** Strip embeddings and auth internals. This is the personal-agent read model. */
export function toPersonalAgentContext(user: User): PersonalAgentContext {
  const context = {
    userUuid: user.uuid,
    identity: {
      firstName: user.firstName,
      lastName: user.lastName,
      cmuEmail: user.cmuEmail,
      phone: user.phone,
    },
    preferenceText: user.preferenceText,
    worker: omitNulls(user.workerProfile),
    requester: omitNulls(user.requesterProfile),
    availability: omitNulls(user.availability),
    stats: user.stats,
    capabilities: {
      canWork: user.workerProfile.enabled && user.availability.isAvailable,
      canRequest: true,
      autoAcceptEnabled:
        user.workerProfile.allowAgentAutoAccept &&
        Boolean(user.workerProfile.autoAcceptRules),
      autoRejectEnabled: user.workerProfile.allowAgentAutoReject,
    },
  };

  return personalAgentContextSchema.parse(context) as PersonalAgentContext;
}

function omitNulls<T extends object>(value: T): T {
  const entries = Object.entries(value).filter(([, item]) => item != null);
  return Object.fromEntries(entries) as T;
}
