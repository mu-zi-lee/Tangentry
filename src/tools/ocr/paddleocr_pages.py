#!/usr/bin/env python3
"""Reproducible page-text OCR for bundled sample PDFs.

Some official PDFs embed Identity-H subset fonts without a ToUnicode CMap, so
their text layer decodes to glyph IDs rather than characters (no extractor can
recover it). This script renders each page and recognises the text with a local
PaddleOCR runtime; nothing is uploaded.

Output JSON records the provenance that retrieval stores alongside the text, so
a baked sample never claims an extractor it did not use:

    {"documentSha256": "...", "extractor": "local-paddleocr",
     "extractorVersion": "paddleocr-<version>", "pages": [{"page": 1, "text": "..."}]}

Pages are processed by a process pool (one model per worker) and the output is
rewritten after every finished page, so a long run is resumable: rerunning the
same command keeps pages already present in the output file.

Usage:
    python paddleocr_pages.py --input doc.pdf --output doc.pages.json \
        [--dpi 200] [--workers 6] [--threads 4] [--limit N] [--resume]
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

_WORKER = {}


def document_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_ocr():
    from paddleocr import PaddleOCR
    # MKLDNN is off by default: Paddle 3.3.x on CPU can abort inside oneDNN.
    if not os.environ.get("OCR_MKLDNN"):
        os.environ["FLAGS_use_mkldnn"] = "0"
    # Mobile models are ~10x faster than the default server models on CPU and
    # accurate enough for dense printed text.
    return PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name="PP-OCRv5_mobile_rec",
        enable_mkldnn=bool(os.environ.get("OCR_MKLDNN")),
    )


def worker_init(pdf_path: str, dpi: int, threads: int):
    # Threads are bounded so several workers share the CPU instead of thrashing.
    os.environ["OMP_NUM_THREADS"] = str(threads)
    import fitz
    _WORKER["doc"] = fitz.open(pdf_path)
    _WORKER["ocr"] = build_ocr()
    _WORKER["dpi"] = dpi
    _WORKER["tmp"] = []


def worker_page(index: int) -> dict:
    ocr = _WORKER["ocr"]
    doc = _WORKER["doc"]
    tmp = Path(f"/tmp/paddleocr-page-{os.getpid()}-{index}.png")
    try:
        doc[index].get_pixmap(dpi=_WORKER["dpi"]).save(tmp)
        result = ocr.predict(str(tmp))
        lines = []
        for item in result or []:
            payload = item if isinstance(item, dict) else item.json.get("res", {})
            lines.extend(t for t in (payload.get("rec_texts") or []) if t)
        return {"page": index + 1, "text": "\n".join(lines)}
    finally:
        tmp.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0, help="only the first N pages (debug)")
    parser.add_argument("--resume", action="store_true", help="keep pages already in --output")
    args = parser.parse_args()

    import multiprocessing as mp
    import paddleocr as paddleocr_module

    src = Path(args.input)
    out_path = Path(args.output)
    sha = document_sha256(src)

    import fitz
    with fitz.open(src) as probe:
        total_all = len(probe)
    total = total_all if args.limit <= 0 else min(args.limit, total_all)

    done: dict[int, str] = {}
    if args.resume and out_path.exists():
        try:
            previous = json.loads(out_path.read_text(encoding="utf-8"))
            if previous.get("documentSha256") == sha:
                done = {p["page"]: p["text"] for p in previous.get("pages", [])}
                print(f"resume: {len(done)} pages already done", file=sys.stderr)
        except (OSError, ValueError, KeyError):
            done = {}

    meta = {
        "documentSha256": sha,
        "extractor": "local-paddleocr",
        "extractorVersion": f"paddleocr-{getattr(paddleocr_module, '__version__', 'unknown')}",
        "dpi": args.dpi,
    }

    def flush():
        pages = [{"page": i + 1, "text": done[i + 1]} for i in range(total) if i + 1 in done]
        payload = dict(meta, pages=pages)
        tmp = out_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(out_path)

    pending = [i for i in range(total) if i + 1 not in done]
    if not pending:
        flush()
        print(f"nothing to do: {total} pages already present", file=sys.stderr)
        return 0

    workers = max(1, min(args.workers, len(pending)))
    print(f"ocr {len(pending)}/{total} pages with {workers} workers", file=sys.stderr, flush=True)
    ctx = mp.get_context("spawn")
    with ctx.Pool(workers, initializer=worker_init, initargs=(str(src), args.dpi, args.threads)) as pool:
        for count, page in enumerate(pool.imap_unordered(worker_page, pending), start=1):
            done[page["page"]] = page["text"]
            if count % 5 == 0 or count == len(pending):
                flush()
                print(f"  {count}/{len(pending)} pages (last p{page['page']}, {len(page['text'])} chars)",
                      file=sys.stderr, flush=True)
        # Close before leaving the context: an abrupt terminate makes Paddle's C++
        # runtime abort on SIGTERM even though the output is already written.
        pool.close()
        pool.join()
    flush()
    print(f"wrote {out_path}: {total} pages, {sum(len(t) for t in done.values())} chars", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())