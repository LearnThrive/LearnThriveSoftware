"""
plan15 Wave 2 section 6.1: one-off, property-aware conversion of hard-coded colours in the marketing
stylesheets to the semantic tokens in src/app/tokens.css.

Not part of the build. Kept in the repo so the conversion is reviewable and re-runnable (it is
idempotent: a token reference is never rewritten). The mapping is by what a colour is FOR in the
declaration it sits in, because the same value plays different roles: `#fff` as a background is a
surface that must go dark in the dark theme, `#fff` as a text colour is text on a navy or accent
fill that must stay light.

    python scripts/tokenise-colours.py --report   # count what is left, change nothing
    python scripts/tokenise-colours.py            # rewrite in place
"""
import collections
import glob
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "src")
FILES = [
    "app/globals.css",
    "app/(public)/home.module.css",
    "app/(public)/about/about.module.css",
    "app/(public)/contact/contact.module.css",
    "app/(public)/faq/faq.module.css",
    "app/(public)/subjects/subjects.module.css",
] + sorted(
    os.path.relpath(p, ROOT).replace("\\", "/")
    for p in glob.glob(os.path.join(ROOT, "components", "**", "*.module.css"), recursive=True)
    if "MotionDebug" not in p
)

# (regex on the whole value, replacement) per property group. Applied in order, case-insensitive.
FG = [
    (r"#fff(?:fff)?\b", "var(--fg-on-inverse)"),
    (r"var\(--colour-white\)", "var(--fg-on-inverse)"),
    (r"#(?:8ed2ad|91d5b0)\b", "var(--fg-accent-on-inverse)"),
    (r"#13c2a0\b", "var(--fg-accent-bright)"),
    (r"rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.(?:8[0-9]?|9[0-9]?)\s*\)", "var(--fg-on-inverse-soft)"),
    (r"rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.(?:6[0-9]?|7[0-9]?)\s*\)", "var(--fg-on-inverse-muted)"),
    (r"#(?:c8d7df|dce7ed|b8cbd4)\b", "var(--fg-on-inverse-soft)"),
    (r"#9fb5c2\b", "var(--fg-on-inverse-muted)"),
    (r"var\(--lt-navy(?:-deep)?\)", "var(--fg-strong)"),
    (r"var\(--colour-(?:ink|navy-900|navy-950)\)", "var(--fg-strong)"),
    (r"#26333f\b", "var(--fg-ink)"),
    (r"var\(--lt-ink\)", "var(--fg-ink)"),
    (r"var\(--lt-text\)", "var(--fg-muted)"),
    (r"#(?:586573|64727e)\b", "var(--fg-muted)"),
    (r"var\(--colour-text\)", "var(--fg-body)"),
    (r"var\(--colour-muted\)", "var(--fg-muted)"),
    (r"var\(--lt-green(?:-dark|-light)?\)", "var(--fg-accent)"),
    (r"var\(--colour-green-(?:700|800)\)", "var(--fg-accent)"),
    (r"var\(--colour-error\)", "var(--fg-error)"),
]
BG = [
    (r"#fff(?:fff)?\b", "var(--surface-1)"),
    (r"var\(--colour-white\)", "var(--surface-1)"),
    (r"#f7f2e8\b", "var(--surface-2)"),
    (r"var\(--lt-cream\)", "var(--surface-2)"),
    (r"#fbf8f[12]\b", "var(--surface-3)"),
    (r"var\(--lt-cream-light\)", "var(--surface-3)"),
    (r"var\(--colour-cream\)", "var(--surface-3)"),
    (r"var\(--colour-sand\)", "var(--surface-sunken)"),
    (r"var\(--lt-navy\)", "var(--surface-inverse)"),
    (r"var\(--lt-navy-deep\)", "var(--surface-inverse-deep)"),
    (r"var\(--colour-navy-900\)", "var(--surface-inverse)"),
    (r"var\(--colour-navy-950\)", "var(--surface-inverse-deep)"),
    (r"var\(--colour-navy-800\)", "var(--surface-inverse-raised)"),
    (r"var\(--colour-mint-100\)", "var(--surface-accent)"),
    (r"#e9f5ef\b", "var(--surface-accent)"),
    (r"#8ed2ad\b", "var(--fg-accent-on-inverse)"),
    (r"var\(--lt-green(?:-dark)?\)", "var(--accent-strong)"),
    (r"var\(--colour-green-800\)", "var(--accent-strong)"),
    (r"var\(--lt-green-light\)", "var(--accent)"),
    (r"var\(--colour-green-700\)", "var(--accent)"),
    (r"var\(--colour-error-bg\)", "var(--error-bg)"),
]
LINE = [
    (r"#(?:e7dfcd)\b", "var(--border-subtle)"),
    (r"var\(--lt-border\)", "var(--border-subtle)"),
    (r"var\(--colour-border\)", "var(--border-subtle)"),
    (r"#(?:d8e0df|e2e5de|d8dfdb)\b", "var(--border-subtle)"),
    (r"#dbd0b8\b", "var(--border-strong)"),
    (r"var\(--lt-navy\)", "var(--fg-strong)"),
    (r"var\(--colour-(?:ink|navy-900)\)", "var(--fg-strong)"),
    (r"var\(--lt-green(?:-dark|-light)?\)", "var(--accent-strong)"),
    (r"var\(--colour-green-(?:700|800)\)", "var(--accent-strong)"),
    (r"#8ed2ad\b", "var(--fg-accent-on-inverse)"),
    (r"var\(--colour-mint-(?:100|200)\)", "var(--surface-accent)"),
]

def group(prop):
    if prop.startswith("--"):
        return None
    if prop in ("color", "caret-color", "text-decoration-color", "fill", "stroke"):
        return FG
    if prop in ("background", "background-color"):
        return BG
    if prop.startswith("border") or prop in ("outline", "outline-color", "column-rule", "box-shadow"):
        return LINE if prop != "box-shadow" else None
    return None

DECL = re.compile(r"(?P<prop>[a-z-]+)(?P<colon>\s*:\s*)(?P<val>[^;{}]+)(?P<end>;)")
COLOUR_LEFT = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--(?:lt|colour)-")


def convert(text):
    def sub(m):
        rules = group(m.group("prop"))
        if not rules:
            return m.group(0)
        val = m.group("val")
        new = val
        for pattern, repl in rules:
            new = re.sub(pattern, repl, new, flags=re.I)
        return f'{m.group("prop")}{m.group("colon")}{new}{m.group("end")}'

    return DECL.sub(sub, text)


def inverse_focus(text):
    """Navy surfaces get the mint focus ring (green-700 is only 2.5:1 on navy-900)."""
    rule = re.compile(r"([^{}@]+)\{([^{}]*)\}")

    def sub(m):
        selector, body = m.group(1), m.group(2)
        if "--focus-colour" in body:
            return m.group(0)
        if re.search(r"(?<![\w-])background(?:-color)?\s*:\s*var\(--surface-inverse(?:-deep)?\)", body):
            indent = re.search(r"\n(\s*)\S", body)
            pad = indent.group(1) if indent else "  "
            body = body.rstrip() + f"\n{pad}--focus-colour: var(--focus-colour-on-inverse);\n"
            return f"{selector}{{{body}}}"
        return m.group(0)

    return rule.sub(sub, text)


def texture(text):
    """Navy surfaces get the faint top-left light and the static grain (tokens.css), unless the rule
    already paints its own background image (a dot grid, a gradient)."""
    rule = re.compile(r"([^{}@]+)\{([^{}]*)\}")

    def sub(m):
        selector, body = m.group(1), m.group(2)
        if "--navy-light" in body or re.search(r"background-image\s*:", body):
            return m.group(0)
        if re.search(r"(?<![\w-])background(?:-color)?\s*:\s*var\(--surface-inverse(?:-deep)?\)\s*(?:!important)?\s*;", body):
            indent = re.search(r"\n(\s*)\S", body)
            pad = indent.group(1) if indent else "  "
            body = body.rstrip() + f"\n{pad}background-image: var(--navy-light), var(--grain);\n"
            return f"{selector}{{{body}}}"
        return m.group(0)

    return rule.sub(sub, text)


def stats(text):
    clean = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return {
        "hex": len(re.findall(r"#[0-9a-fA-F]{3,8}\b", clean)),
        "rgb": len(re.findall(r"rgba?\(", clean)),
        "lt/colour var": len(re.findall(r"var\(--(?:lt|colour)-", clean)),
        "semantic": len(re.findall(r"var\(--(?:surface|fg|border|accent|error-bg)", clean)),
    }


def main():
    report = "--report" in sys.argv
    totals = collections.Counter()
    after_totals = collections.Counter()
    for rel in FILES:
        path = os.path.join(ROOT, rel)
        text = open(path, encoding="utf8").read()
        before = stats(text)
        new = text if report else texture(inverse_focus(convert(text)))
        after = stats(new)
        totals.update(before)
        after_totals.update(after)
        if not report and new != text:
            open(path, "w", encoding="utf8", newline="").write(new)
        print(f"{rel:55s} hex {before['hex']:3d}->{after['hex']:3d}  rgb {before['rgb']:3d}->{after['rgb']:3d}  "
              f"lt/colour var {before['lt/colour var']:3d}->{after['lt/colour var']:3d}  semantic {before['semantic']:3d}->{after['semantic']:3d}")
    print("TOTAL before", dict(totals))
    print("TOTAL after ", dict(after_totals))


if __name__ == "__main__":
    main()
