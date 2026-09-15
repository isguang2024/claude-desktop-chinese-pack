#!/usr/bin/env python3
"""Merge community translations and serve missing strings to Google Translate.

The browser automation talks only to this localhost service.  State is written
after every batch so the operation can be resumed safely.
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import re
import subprocess
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / "frontend-translation-state.json"
OUTPUT_PATH = ROOT / "dist" / "frontend-zh-CN.json"
REPORT_PATH = ROOT / "dist" / "frontend-translation-report.json"
ONLINE_ROOT = Path.home() / "AppData/Local/Temp/claude-zh-online"
MARKER_RE = re.compile(r"⟦(\d{5})⟧\s*")
VARIABLE_RE = re.compile(r"\{\s*([A-Za-z_][\w.-]*)\s*(?=[,}])")
TAG_RE = re.compile(r"</?([A-Za-z][\w.-]*)\b[^>]*>")
LETTER_RE = re.compile(r"[A-Za-z]")
URL_RE = re.compile(r"^(?:https?://|mailto:|[A-Za-z]:\\|/[/\w.-]+$)")


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8-sig") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"JSON root is not an object: {path}")
    return data


def current_english_path() -> Path:
    command = (
        "(Get-AppxPackage Claude | Sort-Object Version -Descending | "
        "Select-Object -First 1 -ExpandProperty InstallLocation)"
    )
    install = subprocess.check_output(
        ["powershell.exe", "-NoProfile", "-Command", command],
        text=True,
        encoding="utf-8",
    ).strip()
    path = Path(install) / "app/resources/ion-dist/i18n/en-US.json"
    if not install or not path.exists():
        raise FileNotFoundError("未找到当前 Claude Desktop 前端英文语言文件")
    return path


def sources() -> list[Path]:
    return [
        ONLINE_ROOT / "Jyy1529-claude-desktop_win-zh_cn/resources/frontend-zh-CN.json",
        ONLINE_ROOT / "good9527-Claude-Desktop-Chinese/dist/zh-CN.json",
        ONLINE_ROOT / "LifeActor-Claude_zh-CN_LanguagePack/translated-zh-CN/ion-dist/zh-CN.json",
        ONLINE_ROOT / "javaht-claude-desktop-zh-cn/resources/frontend-zh-CN.json",
    ]


def signature(text: str) -> tuple:
    return (
        collections.Counter(VARIABLE_RE.findall(text)),
        collections.Counter(TAG_RE.findall(text)),
    )


def valid_translation(source: str, translated: object) -> bool:
    return (
        isinstance(translated, str)
        and bool(translated.strip())
        and signature(source) == signature(translated)
    )


def should_translate(text: str) -> bool:
    stripped = text.strip()
    if not LETTER_RE.search(stripped) or URL_RE.match(stripped):
        return False
    # Machine identifiers, MIME types, shortcuts and bare product names are
    # intentionally retained. They still exist in the final complete JSON.
    if " " not in stripped and re.fullmatch(r"[A-Za-z0-9_.+/@:#-]+", stripped):
        return False
    return True


class TranslationState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.english_path = current_english_path()
        self.english = read_json(self.english_path)
        self.translations: dict[str, str] = {}
        self.attempts: dict[str, int] = {}
        self.issues: dict[str, str] = {}
        self.source_hits: dict[str, int] = {}
        self._load_or_prepare()

    def _load_or_prepare(self) -> None:
        if STATE_PATH.exists():
            saved = read_json(STATE_PATH)
            if saved.get("english_path") == str(self.english_path):
                self.translations = saved.get("translations", {})
                self.attempts = saved.get("attempts", {})
                self.issues = saved.get("issues", {})
                self.source_hits = saved.get("source_hits", {})
                return

        merged: dict[str, str] = {}
        hits: dict[str, int] = {}
        for path in sources():
            if not path.exists():
                continue
            candidate = read_json(path)
            count = 0
            for key, english_value in self.english.items():
                translated = candidate.get(key)
                if key not in merged and translated != english_value and valid_translation(english_value, translated):
                    merged[key] = translated
                    count += 1
            hits[str(path)] = count
        self.translations = merged
        self.source_hits = hits
        self.save()

    def save(self) -> None:
        payload = {
            "english_path": str(self.english_path),
            "translations": self.translations,
            "attempts": self.attempts,
            "issues": self.issues,
            "source_hits": self.source_hits,
        }
        STATE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def pending_keys(self) -> list[str]:
        return [
            key for key, value in self.english.items()
            if key not in self.translations and should_translate(value) and self.attempts.get(key, 0) < 3
        ]

    def next_batch(self, limit: int = 4300) -> dict:
        with self.lock:
            keys = self.pending_keys()
            items = []
            total = 0
            for key in keys:
                value = self.english[key]
                marker = f"⟦{len(items) + 1:05d}⟧ "
                addition = len(marker) + len(value) + 1
                if items and total + addition > limit:
                    break
                items.append({"n": len(items) + 1, "key": key, "source": value})
                total += addition
            return {
                "done": not items,
                "items": items,
                "text": "\n".join(f"⟦{item['n']:05d}⟧ {item['source']}" for item in items),
                "pending": len(keys),
                "translated": len(self.translations),
                "total": len(self.english),
            }

    def accept(self, items: list[dict], result: str) -> dict:
        parts = list(MARKER_RE.finditer(result))
        parsed: dict[int, str] = {}
        for index, match in enumerate(parts):
            end = parts[index + 1].start() if index + 1 < len(parts) else len(result)
            parsed[int(match.group(1))] = result[match.end():end].strip()

        accepted = 0
        rejected = 0
        with self.lock:
            for item in items:
                key = item["key"]
                source = self.english[key]
                translated = parsed.get(int(item["n"]), "")
                self.attempts[key] = self.attempts.get(key, 0) + 1
                if valid_translation(source, translated):
                    self.translations[key] = translated
                    self.issues.pop(key, None)
                    accepted += 1
                else:
                    self.issues[key] = "Google 译文缺失或占位符/标签结构发生变化"
                    rejected += 1
            self.save()
        return {"accepted": accepted, "rejected": rejected, **self.status()}

    def status(self) -> dict:
        pending = self.pending_keys()
        exhausted = [key for key in self.english if key not in self.translations and should_translate(self.english[key]) and self.attempts.get(key, 0) >= 3]
        return {
            "pending": len(pending),
            "exhausted": len(exhausted),
            "translated": len(self.translations),
            "total": len(self.english),
        }

    def finalize(self) -> dict:
        with self.lock:
            output = {key: self.translations.get(key, value) for key, value in self.english.items()}
            OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
            OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
            unchanged = [key for key, value in self.english.items() if output[key] == value]
            report = {
                "english_path": str(self.english_path),
                "total": len(output),
                "translated": len(output) - len(unchanged),
                "unchanged": len(unchanged),
                "issues": self.issues,
                "source_hits": self.source_hits,
            }
            REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            return report


STATE: TranslationState


class Handler(BaseHTTPRequestHandler):
    def respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.respond(204, {})

    def do_GET(self) -> None:
        try:
            if self.path == "/next":
                self.respond(200, STATE.next_batch())
            elif self.path == "/status":
                self.respond(200, STATE.status())
            elif self.path == "/finalize":
                self.respond(200, STATE.finalize())
            else:
                self.respond(404, {"error": "not found"})
        except Exception as exc:
            traceback.print_exc()
            self.respond(500, {"error": repr(exc)})

    def do_POST(self) -> None:
        if self.path != "/save":
            self.respond(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        self.respond(200, STATE.accept(payload["items"], payload["result"]))

def main() -> None:
    global STATE
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--finalize", action="store_true")
    args = parser.parse_args()
    STATE = TranslationState()
    if args.finalize:
        print(json.dumps(STATE.finalize(), ensure_ascii=False, indent=2))
        return
    print(json.dumps({"url": f"http://127.0.0.1:{args.port}", **STATE.status()}, ensure_ascii=False), flush=True)
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
