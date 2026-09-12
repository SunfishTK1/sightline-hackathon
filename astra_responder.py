#!/usr/bin/env python3
"""Auto-reply to allowed iMessage senders with gpt-6-astra.

Polls the Velroi Messages API event stream, asks gpt-6-astra to answer any
inbound message from an allowed number, and sends the answer back through the
same API at text-message length.

Usage:
    python3 astra_responder.py                 # poll forever, start at stream end
    python3 astra_responder.py --once          # one poll pass, then exit
    python3 astra_responder.py --backlog       # also answer unread history
    python3 astra_responder.py --dry           # generate replies, send nothing
    python3 astra_responder.py --selftest "question"   # model check only
    python3 astra_responder.py --send-image pic.png +15550123 "caption"

Inbound images are downloaded from /v1/attachments/{id} and shown to the
model. Outbound images are uploaded to POST /v1/attachments first, then sent
by id. Neither endpoint appears in the published docs or OpenAPI spec.
"""

import base64
import http.client
import json
import mimetypes
import os
import pathlib
import re
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
STATE_PATH = ROOT / ".astra_state.json"

IMESSAGE_BASE = "https://imessage.velroi.com"
OPENAI_URL = "https://api.openai.com/v1/responses"
MODEL = "gpt-6-astra"

# Only these senders get an automated reply. Everything else is ignored.
ALLOWED_SENDERS = {
    "+18455448228",
    "+14808497383",
    "+13122591843",
    "+16467715435",
}

MAX_CHARS = 320           # one text message's worth of answer
HISTORY_TURNS = 8         # how much conversation to carry per sender
POLL_SECONDS = 3
MAX_OUTPUT_TOKENS = 800
ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024  # skip anything too big to inline
# The model accepts only these; iPhone photos arrive as HEIC and need converting.
MODEL_IMAGE_MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
IMAGE_MAX_PIXELS = 2000  # longest edge after conversion
USER_AGENT = "velroi-api-client/1.0"  # urllib's default UA gets a 403

SYSTEM_PROMPT = (
    "You are Astra, answering over iMessage. Reply in at most "
    f"{MAX_CHARS} characters: one or two short sentences of plain text. "
    "No markdown, no bullet lists, no headings, no sign-off. Answer the "
    "question directly. If a full answer would not fit, give the single most "
    "useful part and offer to send the rest if they ask. Images the sender "
    "attaches are given to you directly, so describe what you actually see. "
    "If a note says a file could not be opened, say that plainly instead of "
    "guessing at its contents."
)


def _ssl_context():
    """python.org builds ship no root certs, so fall back to certifi's bundle."""
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


SSL_CONTEXT = _ssl_context()


def log(msg):
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}", flush=True)


def load_env():
    """Read KEY="value" pairs out of .env without requiring python-dotenv."""
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def http_json(url, *, method="GET", headers=None, payload=None, timeout=90):
    """Return (status, parsed_body). HTTP errors come back as values, not raises."""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", USER_AGENT)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
            body = resp.read().decode() or "{}"
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as err:
        raw = err.read().decode(errors="replace")
        try:
            return err.code, json.loads(raw)
        except ValueError:
            return err.code, {"raw": raw}
    except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as err:
        # RemoteDisconnected, connection resets, DNS blips and truncated JSON
        # are all transient. Report them as status 0 so the caller retries.
        return 0, {"error": f"{type(err).__name__}: {err}"}


def http_bytes(url, *, headers=None, timeout=90):
    """Fetch raw bytes. Returns (status, body, content_type)."""
    req = urllib.request.Request(url)
    req.add_header("User-Agent", USER_AGENT)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as resp:
            return resp.status, resp.read(), resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as err:
        return err.code, b"", ""
    except (urllib.error.URLError, http.client.HTTPException, OSError) as err:
        log(f"attachment fetch failed: {type(err).__name__}: {err}")
        return 0, b"", ""


# ---------------------------------------------------------------- state

def load_state():
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {"cursor": 0, "history": {}, "answered": []}


def save_state(state):
    state["answered"] = state["answered"][-500:]
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(STATE_PATH)


def stream_end(api_key):
    """Latest cursor, so a fresh run ignores everything already in the stream."""
    cursor = 0
    while True:
        status, body = http_json(
            f"{IMESSAGE_BASE}/v1/events?after={cursor}&limit=200",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if status != 200:
            log(f"stream_end failed: HTTP {status} {body}")
            return cursor
        nxt = body.get("nextCursor", cursor)
        if not body.get("events") or nxt == cursor:
            return cursor
        cursor = nxt


# ---------------------------------------------------------------- model

def extract_text(resp):
    parts = [
        part.get("text", "")
        for item in resp.get("output", [])
        if item.get("type") == "message"
        for part in item.get("content", [])
        if part.get("type") in ("output_text", "text")
    ]
    return "\n".join(p for p in parts if p).strip()


def shorten(text):
    """Trim to one message, preferring a sentence then a word boundary."""
    text = " ".join(text.split())
    if len(text) <= MAX_CHARS:
        return text
    window = text[:MAX_CHARS]
    cut = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
    if cut > MAX_CHARS * 0.5:
        return window[: cut + 1].strip()
    cut = window.rfind(" ")
    return (window[:cut] if cut > 0 else window).rstrip(" ,;:") + "…"


def ask_astra(openai_key, history):
    status, body = http_json(
        OPENAI_URL,
        method="POST",
        headers={"Authorization": f"Bearer {openai_key}"},
        payload={
            "model": MODEL,
            "instructions": SYSTEM_PROMPT,
            "input": history,
            "max_output_tokens": MAX_OUTPUT_TOKENS,
        },
    )
    if status != 200:
        log(f"{MODEL} error: HTTP {status} {json.dumps(body)[:400]}")
        return None
    text = extract_text(body)
    if not text:
        log(f"{MODEL} returned no text (status={body.get('status')}, "
            f"incomplete={body.get('incomplete_details')})")
        return None
    return shorten(text)


# ---------------------------------------------------------------- sending

def upload_image(api_key, path):
    """Upload a local image and return its attachment id (valid about 24h)."""
    blob = pathlib.Path(path).read_bytes()
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    # The endpoint takes the raw image as the body; multipart is rejected.
    req = urllib.request.Request(
        f"{IMESSAGE_BASE}/v1/attachments", data=blob, method="POST"
    )
    req.add_header("User-Agent", USER_AGENT)
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", mime)
    try:
        with urllib.request.urlopen(req, timeout=120, context=SSL_CONTEXT) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:200]
        log(f"upload of {path} failed: HTTP {err.code} {detail}")
        return None
    except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as err:
        log(f"upload of {path} failed: {type(err).__name__}: {err}")
        return None
    log(f"uploaded {path} as {body.get('attachmentId')} "
        f"(expires {body.get('expiresAt')})")
    return body.get("attachmentId")


def send_reply(api_key, to, text, event_id, dry=False, attachment_ids=None):
    if dry:
        log(f"DRY RUN, would send to {to}: {text}")
        return True
    idem = "astra-" + re.sub(r"[^A-Za-z0-9._:-]", "-", event_id)[:110]
    payload = {"to": to, "text": text, "service": "iMessage", "consent": True}
    if attachment_ids:
        # Bare IDs from POST /v1/attachments; a list of objects is rejected.
        payload["attachments"] = list(attachment_ids)
    status, body = http_json(
        f"{IMESSAGE_BASE}/v1/messages",
        method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Idempotency-Key": idem},
        payload=payload,
    )
    if status == 202:
        log(f"sent to {to} (requestId={body.get('requestId')}): {text}")
        return True
    if status == 403 and body.get("error") == "recipient_opted_out":
        log(f"{to} has opted out; not replying again")
        return True  # nothing to retry
    log(f"send to {to} failed: HTTP {status} {json.dumps(body)[:400]}")
    return False


# ---------------------------------------------------------------- loop

def describe_attachments(attachments):
    """Short human-readable labels, used for logs and for stored history."""
    described = []
    for att in attachments:
        name = att.get("name") or att.get("id") or "attachment"
        mime = att.get("mimeType") or att.get("mime") or "unknown type"
        described.append(f"{name} ({mime})")
    return described


def to_model_image(blob, mime, name):
    """Convert HEIC and other unsupported formats to JPEG via macOS sips.

    Returns (bytes, mime) or (None, mime) if the conversion failed.
    """
    if mime in MODEL_IMAGE_MIMES:
        return blob, mime
    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / "input"
        dst = pathlib.Path(tmp) / "output.jpg"
        src.write_bytes(blob)
        proc = subprocess.run(
            ["sips", "-s", "format", "jpeg", "-Z", str(IMAGE_MAX_PIXELS),
             str(src), "--out", str(dst)],
            capture_output=True,
        )
        if proc.returncode != 0 or not dst.exists():
            detail = proc.stderr.decode(errors="replace").strip()[:160]
            log(f"could not convert {name} from {mime}: {detail}")
            return None, mime
        converted = dst.read_bytes()
    log(f"converted {name} from {mime} to image/jpeg ({len(converted)} bytes)")
    return converted, "image/jpeg"


def fetch_images(api_key, attachments):
    """Download inbound images so the model can actually look at them.

    Returns (image content parts, labels of anything that could not be read).
    """
    parts, skipped = [], []
    for att in attachments:
        name = att.get("name") or att.get("id") or "attachment"
        mime = att.get("mimeType") or ""
        size = att.get("size") or 0
        path = att.get("downloadPath") or f"/v1/attachments/{att.get('id')}"

        if not mime.startswith("image/"):
            skipped.append(f"{name} ({mime or 'unknown type'})")
            continue
        if size and size > ATTACHMENT_MAX_BYTES:
            skipped.append(f"{name} (too large at {size} bytes)")
            continue

        status, blob, ctype = http_bytes(
            f"{IMESSAGE_BASE}{path}", headers={"Authorization": f"Bearer {api_key}"}
        )
        if status != 200 or not blob:
            skipped.append(f"{name} (download failed, HTTP {status})")
            continue

        log(f"downloaded {name} ({len(blob)} bytes)")
        actual = (ctype or mime).split(";")[0].strip().lower()
        blob, actual = to_model_image(blob, actual, name)
        if blob is None:
            skipped.append(f"{name} ({actual}, could not be converted)")
            continue

        encoded = base64.b64encode(blob).decode()
        parts.append({
            "type": "input_image",
            "image_url": f"data:{actual};base64,{encoded}",
        })
    return parts, skipped


def handle_event(event, state, keys, dry=False):
    etype = event.get("type")
    data = event.get("data", {})

    if etype == "recipient.opted_out":
        who = data.get("recipient")
        state["history"].pop(who, None)
        log(f"{who} opted out ({data.get('reason')}); history cleared, no auto-reply")
        return

    if etype != "message.received":
        return

    sender = data.get("sender")
    body_text = (data.get("body") or "").strip()
    event_id = event.get("id") or f"seq-{event.get('sequence')}"

    if sender not in ALLOWED_SENDERS:
        return
    if data.get("optOut"):
        log(f"{sender} sent an opt-out keyword; not replying")
        state["history"].pop(sender, None)
        return
    attachments = data.get("attachments") or []
    described = describe_attachments(attachments)
    if not body_text and not attachments:
        log(f"{sender} sent an empty/undecodable message; skipping")
        return
    if event_id in state["answered"]:
        return

    log(f"{sender} asked: {body_text[:120] or '(no text)'}"
        + (f" [+{len(described)} attachment(s): {', '.join(described)}]" if described else ""))

    images, skipped = fetch_images(keys["imessage"], attachments)

    content = []
    if body_text:
        content.append({"type": "input_text", "text": body_text})
    content.extend(images)
    if skipped:
        content.append({"type": "input_text", "text": (
            f"[Could not open: {', '.join(skipped)}. Say so briefly and ask "
            "them to describe it or send it again as an image.]"
        )})
    if not content:
        content.append({"type": "input_text", "text": "[Empty message received.]"})

    # Stored history stays text-only; base64 images would bloat the state file.
    summary = body_text
    if described:
        label = f"[sent {', '.join(described)}]"
        summary = f"{body_text} {label}" if body_text else label

    prior = state["history"].get(sender, [])[-HISTORY_TURNS * 2:]
    reply = ask_astra(keys["openai"], prior + [{"role": "user", "content": content}])
    turns = prior + [{"role": "user", "content": summary}]

    if reply and send_reply(keys["imessage"], sender, reply, event_id, dry=dry):
        state["answered"].append(event_id)
        turns.append({"role": "assistant", "content": reply})
    state["history"][sender] = turns[-HISTORY_TURNS * 2:]


def poll_once(state, keys, dry=False):
    status, body = http_json(
        f"{IMESSAGE_BASE}/v1/events?after={state['cursor']}&limit=100",
        headers={"Authorization": f"Bearer {keys['imessage']}"},
    )
    if status == 429:
        log("rate limited on polling; backing off 30s")
        time.sleep(30)
        return
    if status != 200:
        log(f"poll failed: HTTP {status} {json.dumps(body)[:300]}")
        time.sleep(10)
        return

    for event in body.get("events", []):
        handle_event(event, state, keys, dry=dry)

    # Cursor advances only after the page is handled and written down.
    state["cursor"] = body.get("nextCursor", state["cursor"])
    save_state(state)


def main():
    args = sys.argv[1:]
    load_env()
    keys = {
        "imessage": os.environ["iMessage_API_KEY"],
        "openai": os.environ["OPEN_AI_HACKATHON_SIGHTLINE_KEY"],
    }

    if "--send-image" in args:
        idx = args.index("--send-image")
        path, to = args[idx + 1], args[idx + 2]
        caption = args[idx + 3] if len(args) > idx + 3 else "Here you go."
        attachment_id = upload_image(keys["imessage"], path)
        if attachment_id:
            send_reply(keys["imessage"], to, caption,
                       f"manual-{int(time.time())}", attachment_ids=[attachment_id])
        return

    if "--selftest" in args:
        question = args[args.index("--selftest") + 1]
        reply = ask_astra(keys["openai"], [{"role": "user", "content": question}])
        log(f"selftest reply ({len(reply or '')} chars): {reply}")
        return

    dry = "--dry" in args
    once = "--once" in args
    state = load_state()

    if not STATE_PATH.exists():
        # Skip the existing backlog unless asked to answer it.
        state["cursor"] = 0 if "--backlog" in args else stream_end(keys["imessage"])
        save_state(state)

    log(f"watching {', '.join(sorted(ALLOWED_SENDERS))} from cursor "
        f"{state['cursor']} with {MODEL}" + (" (dry run)" if dry else ""))

    while True:
        try:
            poll_once(state, keys, dry=dry)
        except Exception as err:  # the poller must outlive any single failure
            log(f"unexpected error, continuing: {type(err).__name__}: {err}")
            time.sleep(10)
        if once:
            log(f"single pass done; cursor {state['cursor']}")
            return
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("stopped")
