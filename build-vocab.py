#!/usr/bin/env python3
"""
build-vocab.py — Parse Obsidian vocabulary-book.md into words.json for the vocab-app.

Usage:
  python3 build-vocab.py

Reads:
  /Users/whalefall/Documents/Obsidian Vault/English/vocabulary-book.md

Writes:
  /Users/whalefall/Documents/vocab-app/words.json
  /Users/whalefall/Documents/vocab-app/audio/*.mp3  (copied from vault)
"""

import re
import json
import shutil
from datetime import datetime
from pathlib import Path

VAULT = Path("/Users/whalefall/Documents/Obsidian Vault")
APP = Path("/Users/whalefall/Documents/vocab-app")

VOCAB_BOOK = VAULT / "English" / "vocabulary-book.md"
VAULT_AUDIO = VAULT / "English" / "audio"
APP_AUDIO = APP / "audio"
WORDS_JSON = APP / "words.json"


def slugify(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def parse_vocabulary_book():
    """Parse vocabulary-book.md. Supports both table rows and card-style entries."""
    content = VOCAB_BOOK.read_text(encoding='utf-8')
    words = []
    current_section_date = None
    current_source = "Unknown"
    current_category = None

    lines = content.split('\n')

    for i, line in enumerate(lines):
        # Date section: ## 2026-04-18 ~ 04-19 · Emotion Vectors 论文
        m = re.match(r'^##\s+(\d{4}-\d{2}-\d{2}.*?)(?:\s*·\s*(.+))?$', line)
        if m:
            current_section_date = m.group(1).split()[0]  # First date
            if m.group(2):
                current_source = m.group(2).strip()
            continue

        # **Source**: [[...|Name]]
        m = re.match(r'^\*\*Source\*\*:\s*(?:\[\[[^|]+\|)?([^\]]+?)(?:\]\])?\s*$', line)
        if m:
            current_source = m.group(1).strip()
            continue

        # Category header: ### 🔬 AI / ML 术语
        m = re.match(r'^###\s+(?:[^\w\s]+\s+)?(.+)$', line)
        if m:
            current_category = m.group(1).strip()
            continue

        # Card-style: #### word `/phonetic/` ⭐⭐⭐ ![[audio.mp3]]
        m = re.match(r'^####\s+(.+?)(?:\s+`([^`]+)`)?(?:\s+(⭐+))?(?:\s+!\[\[([^\]]+)\]\])?\s*$', line)
        if m:
            word = m.group(1).strip()
            phonetic = m.group(2) or ""
            diff = len(m.group(3)) if m.group(3) else 2
            audio_file = m.group(4) or ""

            # Next non-empty line: meaning + example
            meaning, example = "", ""
            for j in range(i+1, min(i+4, len(lines))):
                nl = lines[j].strip()
                if not nl or nl.startswith('#') or nl.startswith('---'):
                    continue
                # Format: "中文释义 · *example*" or "**中文**: ..." or "中文释义\n语境: ..."
                nl = re.sub(r'^(?:\*\*中文\*\*:\s*|中文[:：]\s*)', '', nl)
                # Split on " · " to separate meaning from example
                if ' · ' in nl:
                    parts = nl.split(' · ', 1)
                    meaning = parts[0].strip().rstrip('·').strip()
                    example = re.sub(r'^\*(.+?)\*$', r'\1', parts[1].strip())
                else:
                    meaning = nl
                break

            words.append({
                "id": slugify(word),
                "word": word,
                "phonetic": phonetic,
                "meaning_zh": meaning,
                "example": example,
                "difficulty": diff,
                "source": current_source,
                "category": current_category,
                "audio_file": audio_file,
                "added": current_section_date,
            })
            continue

        # Legacy table row: | word | /phonetic/ | ![[audio.mp3]] | 中文 | 例句 | ⭐⭐ |
        if line.startswith('|') and not line.startswith('|--') and not re.match(r'^\|\s*Word\b', line, re.I):
            cells = [c.strip() for c in line.strip('|').split('|')]
            if len(cells) >= 6 and cells[0] and cells[0] not in ('Word', 'word'):
                word = cells[0]
                phonetic = cells[1].strip('/') if cells[1] else ""
                phonetic = f"/{phonetic}/" if phonetic and phonetic != '—' else ""
                audio_m = re.search(r'!\[\[([^\]]+)\]\]', cells[2])
                audio_file = audio_m.group(1) if audio_m else ""
                meaning = cells[3]
                example = cells[4].strip('"').strip("'") if len(cells) > 4 else ""
                diff = cells[5].count('⭐') if len(cells) > 5 else 2

                words.append({
                    "id": slugify(word),
                    "word": word,
                    "phonetic": phonetic,
                    "meaning_zh": meaning,
                    "example": example,
                    "difficulty": diff,
                    "source": current_source,
                    "category": current_category,
                    "audio_file": audio_file,
                    "added": current_section_date,
                })

    # Deduplicate by id (keep first occurrence)
    seen = set()
    unique = []
    for w in words:
        if w['id'] not in seen:
            seen.add(w['id'])
            unique.append(w)
    return unique


def copy_audio_files(words):
    APP_AUDIO.mkdir(parents=True, exist_ok=True)
    copied = 0
    for w in words:
        if not w.get('audio_file'):
            # Try to find by slug
            candidate = VAULT_AUDIO / f"{w['id']}.mp3"
            if candidate.exists():
                w['audio_file'] = f"{w['id']}.mp3"
            else:
                continue
        src = VAULT_AUDIO / w['audio_file']
        if src.exists():
            dst = APP_AUDIO / w['audio_file']
            if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
                shutil.copy2(src, dst)
                copied += 1
    return copied


def main():
    print(f"📖 Parsing {VOCAB_BOOK}")
    words = parse_vocabulary_book()
    print(f"   Found {len(words)} unique words")

    print(f"🎵 Copying audio files")
    copied = copy_audio_files(words)
    print(f"   Copied {copied} new/updated audio files")

    output = {
        "version": 1,
        "generated_at": datetime.now().isoformat(timespec='seconds'),
        "source_file": str(VOCAB_BOOK.relative_to(VAULT)),
        "count": len(words),
        "words": words,
    }

    WORDS_JSON.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"✅ Wrote {WORDS_JSON}")
    print(f"   {len(words)} words, {copied} audio files")


if __name__ == "__main__":
    main()
