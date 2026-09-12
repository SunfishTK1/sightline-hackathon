# How a task is meant to work

Written down because the same class of bug kept recurring: a task moves into a
state, and some *other* part of the system does not know that state exists —
so it hides the task, denies it, or acts on stale information. Every fault in
this document was real.

The rule underneath all of it: **a task's status is the truth, and every view
of a task must account for every status.** Adding a status is never a local
change.

## The states a task can be in

| status | meaning | still the requester's live request? |
|---|---|---|
| `submitted` | posted, looking for someone | yes |
| `offered` | put to one person, waiting on them | yes |
| `no_takers` | asked around, nobody took it, parked | **yes** — paused, not gone |
| `accepted` | someone is doing it | yes |
| `done_pending` | worker says done, requester has not confirmed | yes |
| `completed` | confirmed and paid | no |
| `cancelled` | called off | no |
| `blocked` | the ethics gate refused it | no |

`no_takers` and `done_pending` are the two that get forgotten. They are live
requests. A person who asks "raise that to $100" means one of these as often
as not.

## The path, end to end

1. **Submitted** — over text, by phone, or from the web. The ethics gate runs
   *before* it can go anywhere. `BLOCK` stores it `blocked` and it is never
   matched or offered. An unreachable gate holds it `pending_review` rather
   than opening it ungated.
2. **Illustrated** — one picture per task. Outreach waits for it, briefly.
3. **Matched** — the matcher picks candidates and an offer row is written.
   The live board shows them `queued`: chosen, *not yet asked*.
4. **Asked** — outreach sends the text. Only now does the board say `waiting`,
   and only now does the ten-minute reply clock start. Counting down against
   someone who has not been messaged is a lie the board used to tell.
5. **Answered** — yes, no, a counter, or silence:
   - **yes** → `accepted`.
   - **counter** → goes to the requester. A higher price is a haggle, not a
     refusal. The broker's ceiling governs what the agent may agree to *on its
     own*; it must never end the negotiation.
   - **no / silence** → the offer closes and the next person is asked.
   - after enough misses → `no_takers`, and the requester is told once.
6. **Done** — the worker marks it, the requester confirms. Two steps, because
   neither side's word alone should release money. The requester may also do
   both at once from the live board: their word that it arrived *is* the
   confirmation, and it is their money.
7. **Paid** — railcoins move on confirmation, on chain, and both sides are
   told what happened to their balance.

## Rules that keep being broken

**Every list of "their requests" must include every live status.** There are
several such lists — `identify_caller`'s `open_requests`, the agent prompt's
`describeMyRequests`, `update_order`'s status filter, the map, the feed. A
status missing from any one of them produces a different bug in a different
place. `describeMyRequests` is the dangerous one: it is presented to the model
as complete, with an instruction to deny anything absent from it, so omitting a
status makes the agent tell its own user their request does not exist.

**Changing the terms of a parked task revives it.** The pause message promises
exactly that. `update_order` sets it back to `submitted` and resets the miss
counter.

**Never show a countdown against someone who has not been asked.** The clock
starts at the text, not at the database write.

**A broadcast has to be actionable.** If a message says "text me if you'll
take it", the recipient must be able to take it — including when someone else
is sitting on an unanswered offer. Someone actively volunteering beats someone
who has not replied.

**Money moves once, at confirmation, and is always narrated.** Both sides hear
what moved and what their balance is. Railcoins are campus credit with no cash
value; say that wherever a dollar figure appears next to them.

**Anything expensive is opt-in.** Films cost 5 railcoins and are only made when
the requester asks. Generating minutes of video for every task, unasked, is not
a feature.

## Where the state actually lives

`voice-mcp` owns the database and is the only writer of task state. The agent
is the only thing that sends messages. `market-maker` owns the live board and
must treat the order as the truth — it reconciles to the order's status rather
than trusting its own event history, because any state change it did not
witness would otherwise leave it confidently wrong.
