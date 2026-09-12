# Which model provider runs this, and how to switch

Everything that calls a model goes through one switch. There are two providers,
OpenAI and xAI. xAI exposes the same *endpoints* this project already used —
`/v1/responses` (with `instructions` + `input` + an `output[]` array),
`/v1/images/generations`, and `/v1/images/edits` — which is why the likeness
feature survives. The request *shapes* differ in three specific ways, all
verified against the live APIs and all encoded in `agent/src/ai.ts`:

| | OpenAI | xAI |
|---|---|---|
| image size | `size: "1024x1024"` | **rejected** — 400 `Argument not supported: size` |
| image response | base64 by default | needs `response_format: "b64_json"`, else a URL |
| reference photo | multipart, `image[]` file part | JSON, `image: { url: "data:image/png;base64,…" }` |

A bare base64 string in `image` is rejected (`invalid type: string`); it must be
an object with `url` or `file_id`. Both paths were run end to end and returned
real pictures, and the edit genuinely conditions on the reference — it kept the
source scene and replaced the subject.

Because xAI ignores `size`, its pictures come back in its own aspect ratio
(~3:2) rather than square.

## Flipping it

```sh
# xAI  (X_AI_API_KEY and XAI_API_KEY are both accepted)
railway variables -s gotchu-agent  --set X_AI_API_KEY=xai-... --set AI_PROVIDER=xai
railway variables -s market-maker  --set X_AI_API_KEY=xai-... --set AI_PROVIDER=xai

# back to OpenAI
railway variables -s gotchu-agent  --set AI_PROVIDER=openai
railway variables -s market-maker  --set AI_PROVIDER=openai
```

`AI_PROVIDER` unset is also valid: whichever key is present wins, preferring
xAI. So dropping in `X_AI_API_KEY` alone is enough to switch, and a deploy
carrying both keys keeps doing whatever the variable says. Nothing requires an
OpenAI key any more — a deploy with only `XAI_API_KEY` is a valid deploy.

The agent prints which one it resolved on every boot:

```
gotchu agent up - xai (chat grok-4.6, images grok-imagine-image-2.0, embeddings none)
```

Read that line before debugging a model problem. Model overrides, if needed:
`AI_CHAT_MODEL`, `AI_IMAGE_MODEL`, `AI_EMBEDDING_MODEL`, `AI_BASE_URL`.

## Defaults per provider

| | OpenAI | xAI |
|---|---|---|
| chat | `gpt-6-astra` | `grok-4.6` |
| images | `gpt-image-2.5-sunburst` | `grok-imagine-image-2.0` |
| embeddings | `text-embedding-3-small` | **none published** |

## The one real difference: embeddings

xAI publishes no embedding model, and the agent's style learning used one to
place somebody against four fixed style archetypes. Rather than lose the
feature, it asks the chat model to pick the archetype instead — a four-way
choice between fixed descriptions, which a chat model does fine. What is lost
is the stored vector, not the behaviour. `person_style.embedding` is `jsonb`, so
an empty array is stored and nothing reads it back.

The web app's preference embeddings are **Gemini** (`text-embedding-004`), not
OpenAI, so they are unaffected by any of this.

## Video is gone

Films are not made any more — they cost real money per task, and xAI has no
video endpoint for this path at all (`/v1/videos` answers "no handler"). What
that removed:

- the agent's `film` and `trailer` loops, and `video.ts`
- the live board's video generation
- the "Make a film — 5 railcoins" button

`POST /v1/orders/:id/film` deliberately still exists and answers **410
`films_disabled`** *before* charging anyone. An old client with a cached button
must get a straight answer and must never be billed for a film that cannot be
made. `FILMS_ENABLED=true` turns the old path back on if video ever returns.

One consequence worth keeping: an offer used to wait up to seven minutes for its
film before going out. It now waits 60 seconds for the picture
(`ASSET_WAIT_MS`), because the only thing that has to happen quickly is asking
somebody to do the job.

Pictures stayed. They are cheap, they are what the live board and the outreach
text actually show, and with a consented profile photo they are drawn to look
like the person.
