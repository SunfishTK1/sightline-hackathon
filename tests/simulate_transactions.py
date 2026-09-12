#!/usr/bin/env python3
"""
Fifty synthetic transactions against the live Gotchu API, chosen to be awkward:
authorisation crossing, double-settlement, haggling that will not end, malformed
input, and money that must never be recorded twice.

Everything runs on the +1 412 555 01xx range, which is reserved for fiction, and
the run purges itself afterwards. Real workers are set unavailable for the
duration so the matcher cannot text a live person about a made-up job.

    python3 tests/simulate_transactions.py
"""

import json
import ssl
import sys
import urllib.error
import urllib.request


def _ssl_context():
    """python.org builds ship no root certs; fall back to certifi's bundle."""
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


SSL_CONTEXT = _ssl_context()

BASE = "https://voice-mcp-production-e7f2.up.railway.app"
UA = "gotchu-sim/1.0"

REAL_WORKERS = ["+18455448228", "+14808497383", "+13122591843", "+16467715435"]

# Synthetic cast.
REQ_A, REQ_B = "+14125550401", "+14125550402"
W1, W2, W3 = "+14125550411", "+14125550412", "+14125550413"

results = []


def api(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("User-Agent", UA)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw[:200]}
    except Exception as e:  # noqa: BLE001 - a transport failure is a test failure
        return 0, {"error": str(e)}


def tool(name, payload):
    return api("POST", "/v1/tools/" + name, payload)


def check(name, condition, detail=""):
    results.append((name, bool(condition), detail))
    print(("  PASS  " if condition else "  FAIL  ") + name + (("  <- " + detail) if detail and not condition else ""))
    return bool(condition)


# ---------------------------------------------------------------- fixtures

def make_order(phone, title, budget=20, **extra):
    payload = {"phone": phone, "source": "web", "title": title,
               "details": title + " (synthetic)", "budget_usd": budget}
    payload.update(extra)
    s, b = tool("submit_order", payload)
    return (b.get("data") or {}).get("order_id"), s, b


def make_offer(order_id, phone, reason="sim", offered=None):
    body = {"order_id": order_id, "phone": phone, "reason": reason}
    if offered is not None:
        body["offered_usd"] = offered
    s, b = api("POST", "/v1/offers", body)
    return (b.get("data") or {}).get("id"), s, b


def mark_sent(offer_id):
    api("POST", f"/v1/offers/{offer_id}/sent")


def offered_job(order_id, worker, offered=None):
    """An offer the worker can actually act on (outreach marked sent)."""
    oid, _, _ = make_offer(order_id, worker, offered=offered)
    if oid:
        mark_sent(oid)
    return oid


def order_status(order_id):
    _, b = api("GET", "/v1/orders?limit=40")
    for o in b.get("data", []):
        if o["id"] == order_id:
            return o["status"]
    return None


def offer_status(offer_id):
    _, b = api("GET", "/v1/offers?limit=40")
    for j in b.get("data", []):
        if str(j["id"]) == str(offer_id):
            return j["status"]
    return None


# ---------------------------------------------------------------- the suite

def run():
    print("\n--- setup ---")
    for w in (W1, W2, W3):
        tool("set_worker_profile", {"phone": w, "is_available": True,
                                    "blurb": "synthetic worker, does campus errands",
                                    "categories": ["errand", "pickup"], "min_price_usd": 10})
    print("  3 synthetic workers ready")

    # 1-5 happy path end to end
    print("\n--- happy path ---")
    oid, s, b = make_order(REQ_A, "SIM happy path", 20)
    check("01 submit_order creates an order", oid, json.dumps(b)[:120])
    jid = offered_job(oid, W1)
    check("02 offer created and marked sent", jid)
    s, b = api("POST", f"/v1/offers/{jid}/respond", {"accepted": True, "phone": W1})
    check("03 worker accepts", (b.get("data") or {}).get("status") == "accepted", json.dumps(b)[:120])
    check("04 order becomes accepted", order_status(oid) == "accepted", str(order_status(oid)))
    s, b = api("POST", f"/v1/orders/{oid}/done", {"phone": W1})
    check("05 worker marks done", (b.get("data") or {}).get("status") == "awaiting_confirmation", json.dumps(b)[:120])

    s, b = api("POST", f"/v1/orders/{oid}/confirm", {"phone": REQ_A, "confirmed": True})
    check("06 requester confirms", (b.get("data") or {}).get("status") == "completed", json.dumps(b)[:120])
    pay = (b.get("data") or {}).get("payment") or {}
    check("07 payment recorded at the agreed amount", str(pay.get("amount_usd")) == "20.00", str(pay))
    check("08 payment blocked on payout setup", pay.get("status") == "awaiting_payout_setup", str(pay.get("status")))

    # 9-12 authorisation crossing
    print("\n--- authorisation ---")
    oid2, _, _ = make_order(REQ_A, "SIM auth checks", 15)
    j2 = offered_job(oid2, W1)
    s, b = api("POST", f"/v1/offers/{j2}/respond", {"accepted": True, "phone": W2})
    check("09 a stranger cannot accept someone else's offer", s == 409, f"HTTP {s}")
    s, b = api("POST", f"/v1/orders/{oid2}/done", {"phone": W2})
    check("10 a stranger cannot mark a job done", s == 409, f"HTTP {s}")
    s, b = api("POST", f"/v1/offers/{j2}/counter", {"phone": W2, "price_usd": 30})
    check("11 a stranger cannot counter", s == 409, f"HTTP {s}")
    s, b = api("POST", f"/v1/orders/{oid2}/confirm", {"phone": REQ_B, "confirmed": True})
    check("12 a stranger cannot confirm completion", s == 409, f"HTTP {s}")

    # 13-17 ordering violations
    print("\n--- out of order ---")
    s, b = api("POST", f"/v1/orders/{oid2}/confirm", {"phone": REQ_A, "confirmed": True})
    check("13 cannot confirm a job nobody marked done", s == 409, f"HTTP {s}")
    s, b = api("POST", f"/v1/orders/{oid}/done", {"phone": W1})
    check("14 cannot re-mark a completed job as done", s == 409, f"HTTP {s}")
    s, b = api("POST", f"/v1/offers/{j2}/respond", {"accepted": True, "phone": W1})
    check("15 first accept works", (b.get("data") or {}).get("status") == "accepted", json.dumps(b)[:100])
    s, b = api("POST", f"/v1/offers/{j2}/respond", {"accepted": False, "phone": W1})
    check("16 cannot decline after accepting", s == 409, f"HTTP {s}")
    s, b = api("POST", f"/v1/offers/{j2}/counter", {"phone": W1, "price_usd": 40})
    check("17 cannot counter after accepting", s == 409, f"HTTP {s}")

    # 18-22 competing offers
    print("\n--- competition ---")
    oid3, _, _ = make_order(REQ_A, "SIM competing offers", 25)
    a1 = offered_job(oid3, W1)
    a2 = offered_job(oid3, W2)
    a3 = offered_job(oid3, W3)
    # Offers are exclusive now: one person is asked at a time, so a second
    # worker cannot be given the same job while the first is still deciding.
    check("18 only one worker can hold a job at a time",
          bool(a1) and not a2 and not a3, f"a1={a1} a2={a2} a3={a3}")
    # Re-quoting a worker updates their existing offer rather than creating a
    # second one: the broker may re-price a live offer.
    dup, s, b = make_offer(oid3, W1, offered=33)
    check("19 re-offering the same worker upserts one offer", str(dup) == str(a1),
          f"first={a1} second={dup}")
    api("POST", f"/v1/offers/{a1}/respond", {"accepted": True, "phone": W1})
    check("20 the holder is accepted", offer_status(a1) == "accepted", str(offer_status(a1)))
    # A volunteer answering a broadcast takes a task nobody offered them.
    s, b = api("POST", f"/v1/orders/{oid3}/claim", {"phone": W2})
    check("21 a second person cannot claim a taken job", s == 409, f"HTTP {s}")
    # A malformed id is a bad request, not a crash.
    s, b = api("POST", "/v1/offers/not-an-id/respond", {"accepted": True, "phone": W3})
    check("22 a malformed offer id is rejected cleanly", s == 400, f"HTTP {s}")

    # 23-29 counter-offers and the round cap
    print("\n--- haggling ---")
    oid4, _, _ = make_order(REQ_A, "SIM haggling", 30)
    j4 = offered_job(oid4, W1)
    s, b = api("POST", f"/v1/offers/{j4}/counter", {"phone": W1, "price_usd": 45, "note": "round 1"})
    d = b.get("data") or {}
    check("23 worker counters", d.get("status") == "countered", json.dumps(b)[:100])
    check("24 round one is not the final round", d.get("final_round") is False, str(d.get("final_round")))
    s, b = api("POST", f"/v1/offers/{j4}/counter/respond", {"phone": REQ_B, "accept": True})
    check("25 a stranger cannot settle a counter", s == 409, f"HTTP {s}")
    api("POST", f"/v1/offers/{j4}/counter/respond", {"phone": REQ_A, "accept": False})
    check("26 declining a counter reopens the offer", offer_status(j4) == "offered", str(offer_status(j4)))
    api("POST", f"/v1/offers/{j4}/counter", {"phone": W1, "price_usd": 42, "note": "round 2"})
    api("POST", f"/v1/offers/{j4}/counter/respond", {"phone": REQ_A, "accept": False})
    s, b = api("POST", f"/v1/offers/{j4}/counter", {"phone": W1, "price_usd": 40, "note": "round 3"})
    check("27 round three warns it is the last", (b.get("data") or {}).get("final_round") is True, json.dumps(b)[:100])
    api("POST", f"/v1/offers/{j4}/counter/respond", {"phone": REQ_A, "accept": False})
    s, b = api("POST", f"/v1/offers/{j4}/counter", {"phone": W1, "price_usd": 38, "note": "round 4"})
    check("28 round four kills the offer", (b.get("data") or {}).get("status") == "cancelled_too_many_rounds", json.dumps(b)[:120])
    check("29 the cancelled offer is really cancelled", offer_status(j4) == "cancelled", str(offer_status(j4)))

    # 30-33 accepting a counter settles at the countered price
    print("\n--- counter accepted ---")
    oid5, _, _ = make_order(REQ_A, "SIM counter accepted", 20)
    j5 = offered_job(oid5, W1)
    api("POST", f"/v1/offers/{j5}/counter", {"phone": W1, "price_usd": 26, "note": "heavier than it looks"})
    s, b = api("POST", f"/v1/offers/{j5}/counter/respond", {"phone": REQ_A, "accept": True})
    check("30 requester accepts the counter", (b.get("data") or {}).get("status") == "accepted", json.dumps(b)[:100])
    check("31 order moves to accepted", order_status(oid5) == "accepted", str(order_status(oid5)))
    _, ob = api("GET", "/v1/orders?limit=40")
    price = next((o.get("budget_usd") for o in ob.get("data", []) if o["id"] == oid5), None)
    check("32 the agreed price replaces the budget", str(price) == "26.00", str(price))
    api("POST", f"/v1/orders/{oid5}/done", {"phone": W1})
    s, b = api("POST", f"/v1/orders/{oid5}/confirm", {"phone": REQ_A, "confirmed": True})
    check("33 payment uses the negotiated price", str(((b.get("data") or {}).get("payment") or {}).get("amount_usd")) == "26.00", json.dumps(b)[:140])

    # 34-37 disputes
    print("\n--- disputes ---")
    oid6, _, _ = make_order(REQ_A, "SIM dispute", 18)
    j6 = offered_job(oid6, W1)
    api("POST", f"/v1/offers/{j6}/respond", {"accepted": True, "phone": W1})
    api("POST", f"/v1/orders/{oid6}/done", {"phone": W1})
    s, b = api("POST", f"/v1/orders/{oid6}/confirm", {"phone": REQ_A, "confirmed": False, "note": "never showed"})
    check("34 requester can dispute", (b.get("data") or {}).get("status") == "disputed", json.dumps(b)[:100])
    check("35 disputed work returns to accepted", order_status(oid6) == "accepted", str(order_status(oid6)))
    api("POST", f"/v1/orders/{oid6}/done", {"phone": W1})
    s, b = api("POST", f"/v1/orders/{oid6}/confirm", {"phone": REQ_A, "confirmed": True})
    check("36 it can be completed on a second attempt", (b.get("data") or {}).get("status") == "completed", json.dumps(b)[:100])
    _, pb = api("GET", "/v1/payments?limit=40")
    dupes = [p for p in pb.get("data", []) if p.get("title") == "SIM dispute"]
    check("37 a disputed-then-completed job is paid once", len(dupes) == 1, f"{len(dupes)} payment rows")

    # 38-41 questions
    print("\n--- questions ---")
    oid7, _, _ = make_order(REQ_A, "SIM questions", 22)
    j7 = offered_job(oid7, W1)
    s, b = api("POST", f"/v1/offers/{j7}/question", {"phone": W1, "question": "Which door?"})
    qid = (b.get("data") or {}).get("question_id")
    check("38 worker asks a question", qid, json.dumps(b)[:100])
    s, b = api("POST", f"/v1/offers/{j7}/question", {"phone": W2, "question": "nosy"})
    check("39 a stranger cannot ask about someone else's job", s == 409, f"HTTP {s}")
    s, b = api("POST", f"/v1/questions/{qid}/answer", {"phone": REQ_B, "answer": "not mine to answer"})
    check("40 a stranger cannot answer", s == 409, f"HTTP {s}")
    s, b = api("POST", f"/v1/questions/{qid}/answer", {"phone": REQ_A, "answer": "The north door."})
    check("41 the requester can answer", (b.get("data") or {}).get("status") == "answered", json.dumps(b)[:100])
    s, b = api("POST", f"/v1/questions/{qid}/answer", {"phone": REQ_A, "answer": "again"})
    check("42 a question cannot be answered twice", s == 409, f"HTTP {s}")

    # 43-47 malformed and hostile input
    print("\n--- bad input ---")
    s, b = tool("identify_caller", {"phone": "+845544823"})
    check("43 a mis-heard phone number is rejected", b.get("ok") is False, json.dumps(b)[:100])
    s, b = tool("identify_caller", {"phone": "12"})
    check("44 a two-digit number is rejected", b.get("ok") is False, json.dumps(b)[:100])
    s, b = tool("submit_order", {"title": "no phone", "details": "x"})
    check("45 an order with no phone and no call is rejected", b.get("ok") is False, json.dumps(b)[:100])
    weird = "Robert'); DROP TABLE orders;-- 🧋 " + "x" * 300
    oid8, s, b = make_order(REQ_B, "SIM hostile input", 12, details=weird)
    check("46 hostile text is stored, not executed", oid8 is not None, json.dumps(b)[:100])
    _, ob = api("GET", "/v1/orders?limit=5")
    check("47 the orders table still exists afterwards", len(ob.get("data", [])) > 0)
    oid9, s, b = make_order(REQ_B, "SIM zero budget", 0)
    check("48 a zero budget is accepted as price-open", oid9 is not None, json.dumps(b)[:100])

    # 49-50 reads the agents depend on
    print("\n--- reads ---")
    s, b = tool("identify_caller", {"phone": REQ_A})
    d = b.get("data") or {}
    check("49 caller lookup returns the whole picture",
          all(k in d for k in ("open_requests", "job_offers_held", "counters_awaiting_them",
                               "questions_awaiting_them", "jobs_in_progress")),
          str(sorted(d.keys()))[:160])
    s, b = api("GET", "/v1/negotiation/pending")
    d = b.get("data") or {}
    check("50 negotiation feed has both sides", "offers" in d and "counters" in d, json.dumps(d)[:100])


def main():
    print("Gotchu transaction simulation - 50 cases")
    print("base:", BASE)

    # Keep the live matcher away from synthetic work.
    print("\npausing real workers...")
    for w in REAL_WORKERS:
        tool("set_worker_profile", {"phone": w, "is_available": False})

    try:
        run()
    finally:
        print("\nrestoring real workers...")
        for w in REAL_WORKERS:
            tool("set_worker_profile", {"phone": w, "is_available": True})
        print("purging synthetic data...")
        s, b = api("POST", "/v1/dev/purge-demo", {})
        print("  purged:", json.dumps(b.get("data")))

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{'=' * 58}\n{passed}/{len(results)} passed")
    failures = [(n, d) for n, ok, d in results if not ok]
    if failures:
        print("\nFAILURES:")
        for n, d in failures:
            print("  -", n, "::", d)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
