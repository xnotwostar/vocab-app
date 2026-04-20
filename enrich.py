#!/usr/bin/env python3
"""
enrich.py — Enrich words.json with synonyms, etymology, more examples using Anthropic API.

Usage:
  export ANTHROPIC_API_KEY=sk-ant-...
  python3 enrich.py [--force]   # --force re-enriches already enriched words

Only enriches words missing the 'enriched' flag, unless --force is passed.
"""

import os
import sys
import json
import time
from pathlib import Path

APP = Path("/Users/whalefall/Documents/vocab-app")
WORDS_JSON = APP / "words.json"

try:
    import anthropic
except ImportError:
    print("❌ Missing dependency. Install with: pip3 install anthropic")
    sys.exit(1)

API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not API_KEY:
    # Try reading from .env
    env_file = APP / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                API_KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
                break

if not API_KEY:
    print("❌ ANTHROPIC_API_KEY not found. Set env var or create .env")
    sys.exit(1)

client = anthropic.Anthropic(api_key=API_KEY)
MODEL = "claude-sonnet-4-5-20250929"


def enrich_word(w):
    """Call Claude to enrich a word. Returns updated dict."""
    prompt = f"""你是英语词汇学习助手。给定一个英文单词及其基础信息，输出补充学习内容。
返回严格 JSON 格式，不要 markdown 包裹，不要额外说明。

输入：
- 单词: {w['word']}
- 音标: {w.get('phonetic', '')}
- 中文: {w.get('meaning_zh', '')}
- 原例句: {w.get('example', '')}
- 来源: {w.get('source', '')}

输出 JSON schema:
{{
  "synonyms": ["近义词1", "近义词2", "近义词3"],
  "antonyms": ["反义词1", "反义词2"],
  "etymology": "词根词源一句话（例如: re- 再 + mini- 小 + -scent → 让人想起小事情）",
  "examples": [
    "例句1（学术/正式场景）",
    "例句2（日常对话）",
    "例句3（科技/商业）"
  ],
  "collocations": ["常见搭配1", "常见搭配2"],
  "confused_with": [
    {{"word": "易混淆词", "diff": "区别一句话"}}
  ],
  "memory_hook": "一句话记忆联想（谐音/形象/典故都行）"
}}

规则：
- synonyms/antonyms 每个最多 3 个，用英文
- examples 每句 10-20 词，用英文
- etymology/memory_hook 用中文
- 找不到的字段填空数组/空字符串，不要编造
- 如果输入不是英文单词（比如中文），所有字段都返回空"""

    resp = client.messages.create(
        model=MODEL,
        max_tokens=1200,
        messages=[{"role": "user", "content": prompt}]
    )
    text = resp.content[0].text.strip()
    # Strip markdown code fence if present
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        data = json.loads(text)
        return {**w, **data, "enriched": True}
    except json.JSONDecodeError as e:
        print(f"   ⚠️ JSON parse failed for {w['word']}: {e}")
        return w


def main():
    force = "--force" in sys.argv
    data = json.loads(WORDS_JSON.read_text())
    words = data["words"]

    targets = [w for w in words if force or not w.get("enriched")]
    print(f"🧠 Enriching {len(targets)} / {len(words)} words")
    if not targets:
        print("   (all already enriched; use --force to redo)")
        return

    # Cost estimate: ~500 tokens each * $3/1M input + ~500 tokens * $15/1M output
    est_cost = len(targets) * 0.003
    print(f"   Estimated cost: ~${est_cost:.2f}")

    for i, w in enumerate(targets):
        print(f"   [{i+1}/{len(targets)}] {w['word']}...", end=" ", flush=True)
        try:
            enriched = enrich_word(w)
            # Update in place
            for j, orig in enumerate(words):
                if orig["id"] == w["id"]:
                    words[j] = enriched
                    break
            print("✓")
        except Exception as e:
            print(f"✗ {e}")
        time.sleep(0.3)  # Gentle rate limiting

        # Save every 10 words to avoid losing progress
        if (i + 1) % 10 == 0:
            data["words"] = words
            WORDS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2))

    data["words"] = words
    data["enriched_at"] = __import__("datetime").datetime.now().isoformat(timespec="seconds")
    WORDS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"✅ Saved {WORDS_JSON}")


if __name__ == "__main__":
    main()
