#!/usr/bin/env python3
"""Bridge the local translation queue and browser automation through clipboard."""

from __future__ import annotations

import base64
import ctypes
import json
import time
import urllib.request


CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
kernel32.GlobalAlloc.restype = ctypes.c_void_p
kernel32.GlobalAlloc.argtypes = (ctypes.c_uint, ctypes.c_size_t)
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = (ctypes.c_void_p,)
kernel32.GlobalUnlock.argtypes = (ctypes.c_void_p,)
user32.GetClipboardData.restype = ctypes.c_void_p
user32.GetClipboardData.argtypes = (ctypes.c_uint,)
user32.SetClipboardData.restype = ctypes.c_void_p
user32.SetClipboardData.argtypes = (ctypes.c_uint, ctypes.c_void_p)


def clipboard_read() -> str:
    if not user32.OpenClipboard(None):
        return ""
    try:
        handle = user32.GetClipboardData(CF_UNICODETEXT)
        if not handle:
            return ""
        pointer = kernel32.GlobalLock(handle)
        if not pointer:
            return ""
        try:
            return ctypes.wstring_at(pointer)
        finally:
            kernel32.GlobalUnlock(handle)
    finally:
        user32.CloseClipboard()


def clipboard_write(text: str) -> None:
    data = (text + "\0").encode("utf-16-le")
    for _ in range(20):
        if user32.OpenClipboard(None):
            break
        time.sleep(0.05)
    else:
        raise RuntimeError("无法打开剪贴板")
    try:
        user32.EmptyClipboard()
        handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
        pointer = kernel32.GlobalLock(handle)
        ctypes.memmove(pointer, data, len(data))
        kernel32.GlobalUnlock(handle)
        user32.SetClipboardData(CF_UNICODETEXT, handle)
    finally:
        user32.CloseClipboard()


def request_json(url: str, payload: dict | None = None) -> dict:
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def encode_message(prefix: str, payload: dict) -> str:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return prefix + base64.b64encode(raw).decode("ascii")


def decode_message(text: str, prefix: str) -> dict:
    return json.loads(base64.b64decode(text[len(prefix):]).decode("utf-8"))


def main() -> None:
    base = "http://127.0.0.1:8799"
    completed_batches = 0
    while True:
        batch = request_json(base + "/next")
        if batch["done"]:
            report = request_json(base + "/finalize")
            clipboard_write(encode_message("CZD1:", report))
            print(json.dumps({"done": True, "batches": completed_batches, **report}, ensure_ascii=False), flush=True)
            return
        clipboard_write(encode_message("CZB1:", batch))
        deadline = time.time() + 180
        while time.time() < deadline:
            current = clipboard_read()
            if current.startswith("CZR1:"):
                result = decode_message(current, "CZR1:")
                saved = request_json(base + "/save", result)
                completed_batches += 1
                print(json.dumps({"batch": completed_batches, **saved}, ensure_ascii=False), flush=True)
                break
            time.sleep(0.15)
        else:
            raise TimeoutError("等待浏览器翻译结果超时")


if __name__ == "__main__":
    main()
