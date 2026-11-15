#!/usr/bin/env python3
"""Independent cross-validation of the eval-b draft evaluation set.

This is a SECOND implementation (Python, no Go code) that re-checks the
generated questions.yaml / fixtures / manifest against the protocol
(docs/evidence/b-eval-protocol.md). It does not trust the generator:
hashes, rune ranges, zero-overlap, positions, baseline predictions and
dataset requirements are all recomputed here.

Run:  python3 test/offline/eval-b/verify_eval_set.py
Exit 0 = all checks pass. DRAFT status is expected and reported, not failed.
"""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
FAILURES = []
CHECKS = 0


def check(cond, msg):
    global CHECKS
    CHECKS += 1
    if not cond:
        FAILURES.append(msg)


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def is_cjk(ch):
    o = ord(ch)
    return 0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF or 0xF900 <= o <= 0xFAFF


def query_terms(text):
    """Independent reimplementation of retrieval.QueryTerms:
    lowercase, Latin/digit word tokens + CJK character bigrams."""
    norm = re.sub(r"\s+", " ", text.lower()).strip()
    terms = set()
    word, cjk = [], []

    def flush_word():
        if word:
            terms.add("".join(word))
            word.clear()

    def flush_cjk():
        if len(cjk) == 1:
            terms.add(cjk[0])
        for i in range(len(cjk) - 1):
            terms.add("".join(cjk[i:i + 2]))
        cjk.clear()

    for ch in norm:
        if is_cjk(ch):
            flush_word()
            cjk.append(ch)
        elif ch.isalnum():
            flush_cjk()
            word.append(ch)
        else:
            flush_word()
            flush_cjk()
    flush_word()
    flush_cjk()
    return terms


def normalize_match(s):
    return re.sub(r"\s+", " ", s.lower()).strip()


def concat_text(snap):
    kind = snap["Kind"]
    if kind == "article":
        return "\n".join(b["Text"] for b in snap["Blocks"])
    if kind == "subtitle":
        return "\n".join(c["Text"] for t in snap["Tracks"] for c in t["Cues"])
    if kind == "pdf":
        return "\n".join(p["Text"] for p in snap["Pages"])
    raise ValueError(kind)


def unit_texts(snap):
    """Ordered list of (unit_id, text) for range checks."""
    kind = snap["Kind"]
    if kind == "article":
        return [(b["Index"], b["Text"]) for b in snap["Blocks"]]
    if kind == "pdf":
        return [(p["Number"], p["Text"]) for p in snap["Pages"]]
    if kind == "subtitle":
        out = []
        for t in snap["Tracks"]:
            cues = t["Cues"]
            # reproduce 3-8 cues / 15-60s grouping (4s cues -> groups of 4)
            i = 0
            while i < len(cues):
                count = 1
                while count < 8 and i + count < len(cues):
                    nxt = cues[i + count]
                    if nxt["EndMs"] - cues[i]["StartMs"] > 60000:
                        break
                    count += 1
                    if count >= 3 and cues[i + count - 1]["EndMs"] - cues[i]["StartMs"] >= 15000:
                        break
                out.append((f'{t["Language"]}:{i}-{i + count - 1}',
                            "\n".join(c["Text"] for c in cues[i:i + count])))
                i += count
        return out
    raise ValueError(kind)


def baseline_context(source, limit):
    if len(source) <= limit:
        return source
    remaining = limit - 40
    head = (remaining + 1) // 2
    tail = remaining - head
    return "相关内容片段：\n" + source[:head] + "\n……\n" + source[len(source) - tail:]


def baseline_hit(source, gold, limit):
    return normalize_match(gold) in normalize_match(baseline_context(source, limit))


def main():
    qs = yaml.safe_load((ROOT / "questions.yaml").read_text(encoding="utf-8"))
    manifest = json.loads((ROOT / "dataset-manifest.json").read_text(encoding="utf-8"))
    check(qs["version"] == 1, "version must be 1")
    check(qs["status"] in ("draft-pending-human-confirmation", "confirmed"),
          "unexpected status (human confirmation gate)")
    confirmed = qs["status"] == "confirmed"
    if confirmed:
        check(qs.get("confirmed_by") and qs.get("confirmed_at"),
              "confirmed set must record confirmed_by/confirmed_at")
    questions = qs["questions"]
    primary = [q for q in questions if q.get("primary_denominator")]
    check(len(primary) >= 20, f"primary answerable {len(primary)} < 20")
    check(all(q["answerable"] for q in questions), "all records answerable=true")

    snaps = {}
    for f in sorted((ROOT / "fixtures").glob("*.json")):
        snap = json.loads(f.read_text(encoding="utf-8"))
        snaps[snap["ContentID"]] = snap

    thirds = {"head": 0, "middle": 0, "tail": 0}
    paraphrase = []
    distractor_docs = {}
    qman = {q["question_id"]: q for q in manifest["questions"]}
    dman = {d["doc_id"]: d for d in manifest["documents"]}

    for q in questions:
        qid = q["question_id"]
        for field in ("question_id", "doc_id", "question", "answerable", "gold_source",
                      "gold_locator", "gold_passage_text", "gold_passage_sha256",
                      "gold_source_version", "annotator", "annotated_at"):
            check(field in q and q[field] not in (None, ""), f"{qid}: missing field {field}")
        if confirmed:
            check("UNCONFIRMED" not in q["annotator"], f"{qid}: stale draft annotator")
        else:
            check("UNCONFIRMED" in q["annotator"], f"{qid}: draft annotator marker missing")
        gold = q["gold_passage_text"]
        check(q["gold_passage_sha256"] == sha256(gold), f"{qid}: sha256 mismatch")
        check(all(ord(c) <= 0xFFFF for c in gold), f"{qid}: astral character in gold")
        check("\x00" not in gold, f"{qid}: NUL in gold")

        snap = snaps[q["doc_id"]]
        text = concat_text(snap)
        check(gold in text, f"{qid}: gold text not present in document")

        # exact rune-range check inside the named unit
        loc = q["gold_locator"]
        if q["gold_source"] == "article":
            m = re.fullmatch(r"article:(\d+):s(\d+)(?:-s(\d+))?", loc)
            check(m is not None, f"{qid}: bad article locator {loc}")
            if m:
                bidx = int(m.group(1))
                unit = snap["Blocks"][bidx]["Text"]
                sr, er = q["gold_rune_range"].split("-")
                check(unit[int(sr):int(er)] == gold, f"{qid}: article rune range mismatch")
                check(q["gold_unit_index"] == bidx, f"{qid}: unit index mismatch")
        elif q["gold_source"] == "pdf":
            m = re.fullmatch(r"pdf:([0-9a-f]{64}):(\d+):s(\d+)(?:-s(\d+))?", loc)
            check(m is not None, f"{qid}: bad pdf locator {loc}")
            if m:
                page = next(p for p in snap["Pages"] if p["Number"] == int(m.group(2)))
                check(page["DocumentSHA256"] == m.group(1), f"{qid}: pdf doc hash mismatch")
                sr, er = q["gold_rune_range"].split("-")
                check(page["Text"][int(sr):int(er)] == gold, f"{qid}: pdf rune range mismatch")
        elif q["gold_source"] == "subtitle":
            m = re.fullmatch(r"subtitle:([a-z]+):(\d+)-(\d+)", loc)
            check(m is not None, f"{qid}: bad subtitle locator {loc}")
            if m:
                track = next(t for t in snap["Tracks"] if t["Language"] == m.group(1))
                cs, ce = int(m.group(2)), int(m.group(3))
                joined = "\n".join(c["Text"] for c in track["Cues"][cs:ce + 1])
                check(joined == gold, f"{qid}: subtitle cue group mismatch")
                check(q["gold_cue_ids"] == [c["ID"] for c in track["Cues"][cs:ce + 1]],
                      f"{qid}: cue IDs mismatch")

        # position / baseline cross-check against manifest
        mq = qman[qid]
        off = text.index(gold)
        frac = off / len(text)
        third = "head" if frac < 1 / 3 else ("tail" if frac > 2 / 3 else "middle")
        check(third == q["position_third"], f"{qid}: position third {third} != {q['position_third']}")
        check(abs(frac - mq["position_fraction"]) < 0.001, f"{qid}: manifest fraction mismatch")
        for limit, key in ((120000, "baseline_hit_120k"), (8000, "baseline_hit_8k")):
            check(baseline_hit(text, gold, limit) == mq[key],
                  f"{qid}: baseline prediction mismatch at {limit}")
        thirds[third] += 1

        # zero-overlap subsets (independent tokenizer)
        if q["subset"] in ("paraphrase", "distractor"):
            shared = query_terms(q["question"]) & query_terms(gold)
            check(not shared, f"{qid}: zero-overlap violated, shared terms: {sorted(shared)[:8]}")
        if q["subset"] == "paraphrase":
            paraphrase.append(q)
        if q["subset"] == "distractor":
            distractor_docs.setdefault(q["doc_id"], []).append(q)

        # BMP-only document check
        check(all(ord(c) <= 0xFFFF for c in text), f"{qid}: astral character in document")

    # dataset-level requirements (protocol §2)
    check(thirds["middle"] > len(primary) / 2, f"middle-third not majority: {thirds}")
    check(thirds["head"] >= 1 and thirds["tail"] >= 1, "missing head/tail controls")
    check(len(paraphrase) >= 2, "need >=2 zero-overlap paraphrase pairs")
    same_lang = [q for q in paraphrase
                 if any(is_cjk(c) for c in q["question"]) and any(is_cjk(c) for c in q["gold_passage_text"])]
    cross_lang = [q for q in paraphrase
                  if any(is_cjk(c) for c in q["question"]) and not any(is_cjk(c) for c in q["gold_passage_text"])]
    check(len(same_lang) >= 1, "need >=1 same-language paraphrase")
    check(len(cross_lang) >= 1, "need >=1 cross-language paraphrase")
    check(len(distractor_docs) >= 2, "need >=2 distractor-saturated documents")

    for doc_id, dqs in distractor_docs.items():
        snap = snaps[doc_id]
        for q in dqs:
            terms = query_terms(q["question"])
            saturated = sum(1 for b in snap["Blocks"]
                            if b["Kind"] == "paragraph" and terms & query_terms(b["Text"]))
            check(saturated >= 20, f"{doc_id}: only {saturated} query-term passages (<20)")
            mq = qman[q["question_id"]]
            check(mq["on_sweep_sample"] in (True, False), "on_sweep_sample must be boolean")
    all_ons = [qman[q["question_id"]]["on_sweep_sample"]
               for dqs in distractor_docs.values() for q in dqs]
    check(True in all_ons and False in all_ons,
          "distractor documents must cover on-sample AND off-sample outcomes")

    # repeated sentence / cue requirements
    a1 = concat_text(snaps["fixture:article-main"])
    b007 = next(q for q in questions if q["question_id"] == "BQ-007")
    check(a1.count(b007["gold_passage_text"]) >= 2, "BQ-007 gold sentence must repeat")
    s1 = snaps["fixture:subtitle-lecture"]
    cue_texts = [c["Text"] for t in s1["Tracks"] for c in t["Cues"]]
    b013 = next(q for q in questions if q["question_id"] == "BQ-013")
    answer_cue = next(c for c in b013["gold_passage_text"].split("\n") if "脑裂" in c)
    check(cue_texts.count(answer_cue) >= 2, "BQ-013 answer cue must repeat")

    # heading trap: BQ-006 terms in an earlier heading block
    b006 = next(q for q in questions if q["question_id"] == "BQ-006")
    terms006 = query_terms(b006["question"])
    gold_block = b006["gold_unit_index"]
    trap = [b for b in snaps["fixture:article-main"]["Blocks"]
            if b["Kind"] == "heading" and b["Index"] < gold_block and terms006 & query_terms(b["Text"])]
    check(len(trap) >= 1, "BQ-006 heading trap missing")

    # document lengths / manifest consistency
    for d in manifest["documents"]:
        snap = snaps[d["doc_id"]]
        text = concat_text(snap)
        check(d["text_sha256"] == sha256(text), f"{d['doc_id']}: manifest text hash mismatch")
        txt_file = (ROOT / d["text_file"]).read_text(encoding="utf-8")
        check(txt_file == text, f"{d['doc_id']}: .txt file differs from snapshot concat")
        check(d["total_runes"] == len(text), f"{d['doc_id']}: rune count mismatch")
        if d["doc_id"] != "fixture:pdf-ocr-subset":
            check(len(text) > 120000, f"{d['doc_id']}: document must exceed 120k budget")
        n = d["candidates"]
        s = d["sweep_s"]
        expect = [k * n // s for k in range(s)] if s < n else list(range(n))
        check(d["sweep_sample_indices"] == expect, f"{d['doc_id']}: sweep indices mismatch")
        check(d["sweep_limited"] == (s < n), f"{d['doc_id']}: sweep limited flag mismatch")
        check(d["sweep_stride"] == math.ceil(n / s), f"{d['doc_id']}: stride mismatch")

    # primary documents must all be sweep-limited (protocol §2 clamp fixture)
    check(all(d["sweep_limited"] for d in manifest["documents"]),
          "all evaluation documents should clamp the sweep (N > S)")

    print(f"checks run: {CHECKS}")
    if FAILURES:
        print(f"FAILURES ({len(FAILURES)}):")
        for f in FAILURES:
            print("  -", f)
        sys.exit(1)
    print("ALL CHECKS PASSED (independent Python cross-validation)")
    if confirmed:
        print(f"SET CONFIRMED by {qs['confirmed_by']} at {qs['confirmed_at']} - frozen for Phase 7.")
    else:
        print("NOTE: set is DRAFT - every label still requires human confirmation (WANG Jiaqi).")


if __name__ == "__main__":
    main()
