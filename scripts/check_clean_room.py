#!/usr/bin/env python3
"""
Clean-room compliance scanner.
Scans all tracked text files for:
  - Private data patterns
  - Copyrighted/trademarked Bible translations
  - Third-party trademarks (word-boundary case-insensitive + compound token scan)
Fails (exit 1) if any file contains violations.
"""

import os
import re
import sys
from pathlib import Path

# ── Configuration ────────────────────────────────────────────────────────────

# File extensions to scan
TEXT_EXTS = {
    ".rs", ".ts", ".tsx", ".js", ".jsx", ".json", ".toml", ".md",
    ".yml", ".yaml", ".html", ".css", ".py",
}

# Directories to EXCLUDE from scanning
EXCLUDE_DIRS = {".git", "node_modules", "target", "dist", "package-lock.json", "Cargo.lock", "scripts/check_clean_room.py"}

# Private data regexes
PRIVATE_DATA_PATTERNS = [
    re.compile(r"10\.1\.24\.\d+"),          # IP-like private data
    re.compile(r"/Users/"),                 # macOS home path
    re.compile(r"/home/"),                 # Linux home path
    re.compile(r"C:\\Users\\"),            # Windows user path
    re.compile(r"KhanTheDaleK"),           # personal repo handle
    re.compile(r"@gmail\."),               # email domain
    re.compile(r"@icloud\."),              # email domain
    re.compile(r"@yahoo\."),               # email domain
]

# Bible translation patterns (word-boundary, case-sensitive as specified)
BIBLE_PATTERNS = [
    re.compile(r"\bNIV\b"),
    re.compile(r"\bESV\b"),
    re.compile(r"\bNLT\b"),
]

# Third-party tradems: (word-boundary case-insensitive) +
# compound token scan in identifiers like obs_, x32_, dante_, ndi_, visca_,
# propresenter, easyworship, streamlabs, songselect, ccli,
# behringer, audinate, midas, newtek, vizrt, ptzoptics, birddog,
# shure, ulxd4, elgato, decklink, blackmagic, valhalla,
# nvenc, videotoolbox, syphon, spout, bonjour, ultranet,
# aes50, youtube, facebook, twitch, livepeer,
# powerpoint, google, chrome, apple, nvidia, sony,
# panasonic, aja, "stream deck", x-touch, m32
#
# We treat each as a word-boundary case-insensitive pattern.
# Additionally, we scan identifiers (e.g. variable names) for these substrings.

TRADEMARK_TERMS = [
    "obs", "x32", "dante", "ndi", "visca",
    "propresenter", "easyworship", "streamlabs",
    "songselect", "ccli",
    "behringer", "audinate", "midas", "newtek", "vizrt",
    "ptzoptics", "birddog", "shure", "ulxd4", "elgato",
    "decklink", "blackmagic", "valhalla", "nvenc",
    "videotoolbox", "syphon", "spout", "bonjour", "ultranet",
    "aes50", "youtube", "facebook", "twitch", "livepeer",
    "powerpoint", "google", "chrome", "apple", "nvidia",
    "sony", "panasonic", "aja",
    "stream deck", "x-touch", "m32",
]

# Build word-boundary case-insensitive patterns for each term.
# For multi-word phrases like "stream deck", "x-touch", "m32",
# we build a pattern that matches the whole phrase at a word boundary.
TRADEMARK_PATTERNS = []

for term in TRADEMARK_TERMS:
    if " " in term:
        # Multi-word phrase: match the whole phrase as a unit at word boundaries
        # Escape special regex chars and join with \s*
        escaped = term.replace("-", r"\-").replace(" ", r"\s+")
        pattern = re.compile(rf"\b{escaped}\b", re.IGNORECASE)
    else:
        # Single word: word-boundary case-insensitive
        escaped = re.escape(term)
        pattern = re.compile(rf"\b{escaped}\b", re.IGNORECASE)
    TRADEMARK_PATTERNS.append(pattern)

# Also build substring patterns for identifier scanning (e.g. obs_, x32_, etc.)
# These catch cases where the term appears as a prefix in an identifier like obs_, x32_, etc.
# We match the term followed by underscore to avoid false positives in prose words
# (e.g. "ndi" inside "findings" or "indicators").
IDENTIFIER_SUBSTRING_PATTERNS = []
for term in TRADEMARK_TERMS:
    escaped = re.escape(term)
    IDENTIFIER_SUBSTRING_PATTERNS.append(re.compile(rf"{escaped}_", re.IGNORECASE))


# ── Helpers ──────────────────────────────────────────────────────────────────


def is_excluded_path(filepath: str) -> bool:
    """Return True if filepath should be excluded from scanning."""
    # Check against excluded directories
    path = Path(filepath)
    for part in path.parts:
        if part in EXCLUDE_DIRS:
            return True
    # Also exclude the script itself
    script_path = Path(__file__).resolve()
    if filepath == str(script_path):
        return True
    return False


def has_private_data(content: str, filepath: str) -> list:
    """Check for private data patterns. Returns list of (pattern_name, match) tuples."""
    violations = []
    for pattern in PRIVATE_DATA_PATTERNS:
        for m in pattern.finditer(content):
            violations.append((pattern.pattern, m.group()))
    return violations


def has_bible_translation(content: str) -> list:
    """Check for copyrighted/trademarked Bible translations. Returns list of matches."""
    violations = []
    for pattern in BIBLE_PATTERNS:
        for m in pattern.finditer(content):
            violations.append((pattern.pattern, m.group()))
    return violations


def has_trademark(content: str) -> list:
    """Check for third-party trademarks (word-boundary case-insensitive + compound token scan).
    Returns list of (pattern_name, match) tuples."""
    violations = []

    # First: word-boundary case-insensitive matches
    for pattern in TRADEMARK_PATTERNS:
        for m in pattern.finditer(content):
            violations.append((pattern.pattern, m.group()))

    # Second: compound token scan in identifiers
    # We need to check if any identifier/substring from TRADEMARK_TERMS appears
    # as a substring in the content. We'll look for word-like substrings that
    # match the trademark terms.
    for pattern in IDENTIFIER_SUBSTRING_PATTERNS:
        for m in pattern.finditer(content):
            # Avoid duplicating violations that already matched word-boundary
            already = any(m.group() == v[1] and pattern.pattern == v[0] for v in violations)
            if not already:
                violations.append((pattern.pattern, m.group()))

    return violations


def scan_file(filepath: str) -> list:
    """Scan a single file. Returns list of (category, match) violations."""
    violations = []

    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception:
        return violations

    # Check private data
    private = has_private_data(content, filepath)
    for pat, match in private:
        violations.append(("PRIVATE_DATA", f"{filepath}:{pat}:{match}"))

    # Check Bible translations
    bible = has_bible_translation(content)
    for pat, match in bible:
        violations.append(("BIBLE_TRANSLATION", f"{filepath}:{pat}:{match}"))

    # Check trademarks
    tm = has_trademark(content)
    for pat, match in tm:
        violations.append(("TRADEMARK", f"{filepath}:{pat}:{match}"))

    return violations


def find_text_files(root: str) -> list:
    """Find all tracked text files excluding certain dirs and files."""
    result = []
    root_path = Path(root)

    for dirpath, dirnames, filenames in os.walk(root_path):
        # Prune excluded directories
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]

        for filename in filenames:
            filepath = os.path.join(dirpath, filename)

            # Skip excluded paths
            if is_excluded_path(filepath):
                continue

            # Check extension
            ext = Path(filepath).suffix.lower()
            if ext in TEXT_EXTS:
                result.append(filepath)

    return result


def main():
    root = os.getcwd()
    text_files = find_text_files(root)

    all_violations = []
    for filepath in sorted(text_files):
        viols = scan_file(filepath)
        all_violations.extend(viols)

    if all_violations:
        # Print clear diagnostics
        print("=" * 60)
        print("CLEAN-ROOM VIOLATIONS FOUND")
        print("=" * 60)
        for category, detail in all_violations:
            print(f"  [{category}] {detail}")

        # Print summary count
        counts = {}
        for category, _ in all_violations:
            counts[category] = counts.get(category, 0) + 1
        print()
        print("Summary:")
        for cat, cnt in sorted(counts.items()):
            print(f"  {cat}: {cnt}")

        print("=" * 60)
        print(f"Total violations: {len(all_violations)}")
        print("=" * 60)
        sys.exit(1)

    print("No violations found. Clean room compliance verified.")
    sys.exit(0)


if __name__ == "__main__":
    main()