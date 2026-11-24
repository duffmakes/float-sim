#!/usr/bin/env python3
"""Turns one of Float Sim's Markdown reports into a self-contained HTML page (no scripts, no external files except
the images it links to, light and dark themes). Standard library only; covers the Markdown the reports use:
headings, paragraphs, bullet and numbered lists (nested by 4 spaces), pipe tables, fenced code, images, links,
**bold**, *italic*, `code` and <sub>/<sup>.

    python3 tools/md_to_html.py docs/rao-solver-review.md [docs/rao-solver-review.html]
"""
import html, re, sys

CSS = """
:root { --bg: #ffffff; --ink: #1f2328; --ink2: #59636e; --line: #d8dee4; --soft: #f6f8fa; --link: #0969da; --mark: #ddf4ff; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --ink: #e6edf3; --ink2: #9198a1; --line: #30363d; --soft: #161b22; --link: #4493f8; --mark: #12263f; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 28px; line-height: 1.25; margin: 0 0 4px; }
h2 { font-size: 21px; margin: 40px 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
h3 { font-size: 17px; margin: 28px 0 6px; }
h4 { font-size: 15px; margin: 24px 0 6px; }
p, ul, ol { margin: 8px 0; }
li { margin: 3px 0; }
a { color: var(--link); }
code { font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--soft); padding: 1px 4px; border-radius: 4px; }
pre { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 12px; overflow-x: auto; }
pre code { background: none; padding: 0; }
p code, li code { overflow-wrap: anywhere; }
.tbl { overflow-x: auto; margin: 12px 0; }
table { border-collapse: collapse; font-size: 13.5px; }
th, td { border: 1px solid var(--line); padding: 5px 9px; vertical-align: top; }
th { background: var(--soft); text-align: left; font-weight: 600; }
td.num, th.num { text-align: right; white-space: nowrap; }
img { display: block; max-width: 100%; height: auto; margin: 8px 0 4px; border: 1px solid var(--line); border-radius: 4px; background: #fff; }
.date { color: var(--ink2); margin-bottom: 8px; }
nav.toc { background: var(--soft); border: 1px solid var(--line); border-radius: 6px; padding: 10px 16px; margin: 16px 0 8px; font-size: 14px; }
nav.toc ol { margin: 4px 0; padding-left: 22px; }
.src { color: var(--ink2); font-size: 13px; margin-top: 48px; border-top: 1px solid var(--line); padding-top: 8px; }
"""

ALLOWED = re.compile(r'&lt;(/?)(sub|sup)&gt;')


def inline(text):
    t = html.escape(text, quote=False)
    t = ALLOWED.sub(r'<\1\2>', t)
    codes = []
    t = re.sub(r'`([^`]+)`', lambda m: codes.append(m.group(1)) or f'\x00{len(codes) - 1}\x00', t)
    t = re.sub(r'!\[([^\]]*)\]\(([^)\s]+)\)', lambda m: f'<img src="{m.group(2)}" alt="{m.group(1)}" loading="lazy">', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', lambda m: f'<a href="{re.sub(r"[.]md$", ".html", m.group(2)) if m.group(2).endswith("rao-solver-review.md") else m.group(2)}">{m.group(1)}</a>', t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])', r'<em>\1</em>', t)
    t = re.sub(r'\\([_*\[\]|\\])', r'\1', t)
    return re.sub('\x00(\\d+)\x00', lambda m: f'<code>{codes[int(m.group(1))]}</code>', t)


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', re.sub(r'<[^>]+>', '', text).lower()).strip('-')


def convert(md):
    lines = md.split('\n')
    out, toc, i, title = [], [], 0, 'Report'

    def table(rows):
        cells = [[c.strip() for c in re.split(r'(?<!\\)\|', r.strip().strip('|'))] for r in rows]
        align = ['num' if re.fullmatch(r':?-+:', c) else '' for c in cells[1]]
        h = '<div class="tbl"><table><thead><tr>' + ''.join(f'<th class="{a}">{inline(c)}</th>' for c, a in zip(cells[0], align)) + '</tr></thead><tbody>'
        for r in cells[2:]:
            h += '<tr>' + ''.join(f'<td class="{a}">{inline(c)}</td>' for c, a in zip(r, align)) + '</tr>'
        return h + '</tbody></table></div>'

    def lists(block):
        # block: list of (indent, ordered, text)
        html_, stack = '', []
        for ind, ordered, text in block:
            depth = ind // 4
            while len(stack) > depth + 1:
                html_ += f'</li></{stack.pop()}>'
            if len(stack) == depth + 1:
                html_ += '</li>'
            while len(stack) < depth + 1:
                tag = 'ol' if ordered else 'ul'
                html_ += f'<{tag}>'
                stack.append(tag)
            html_ += f'<li>{inline(text)}'
        while stack:
            html_ += f'</li></{stack.pop()}>'
        return html_

    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1
            continue
        if ln.startswith('```'):
            lang, j = ln[3:].strip(), i + 1
            while j < len(lines) and not lines[j].startswith('```'):
                j += 1
            out.append(f'<pre><code class="{lang}">' + html.escape('\n'.join(lines[i + 1:j])) + '</code></pre>')
            i = j + 1
            continue
        m = re.match(r'(#{1,4}) (.*)', ln)
        if m:
            lvl, txt = len(m.group(1)), m.group(2)
            if lvl == 1:
                title = re.sub(r'\\', '', txt)
                out.append(f'<h1>{inline(txt)}</h1>')
            else:
                sid = slug(inline(txt))
                if lvl == 2:
                    toc.append((sid, inline(txt)))
                out.append(f'<h{lvl} id="{sid}">{inline(txt)}</h{lvl}>')
            i += 1
            continue
        if ln.lstrip().startswith('|'):
            j = i
            while j < len(lines) and lines[j].lstrip().startswith('|'):
                j += 1
            out.append(table(lines[i:j]))
            i = j
            continue
        if re.match(r'\s*([-*]|\d+\.) ', ln):
            block = []
            while i < len(lines) and lines[i].strip():
                mm = re.match(r'(\s*)([-*]|\d+\.) (.*)', lines[i])
                if mm:
                    block.append([len(mm.group(1)), mm.group(2)[0].isdigit(), mm.group(3)])
                elif block:
                    block[-1][2] += ' ' + lines[i].strip()
                i += 1
            out.append(lists(block))
            continue
        para = []
        while i < len(lines) and lines[i].strip() and not re.match(r'(#{1,4} |```|\s*\||\s*([-*]|\d+\.) )', lines[i]):
            para.append(lines[i].strip())
            i += 1
        text = ' '.join(para)
        if re.fullmatch(r'!\[[^\]]*\]\([^)]+\)', text):
            out.append(inline(text))
        elif re.fullmatch(r'\d{1,2} \w+ \d{4}', text) and len(out) == 1:
            out.append(f'<p class="date">{inline(text)}</p>')
        else:
            out.append(f'<p>{inline(text)}</p>')
    nav = '<nav class="toc"><strong>Contents</strong><ol>' + ''.join(f'<li><a href="#{s}">{t}</a></li>' for s, t in toc) + '</ol></nav>'
    head = out[:2] if len(out) > 1 and out[1].startswith('<p class="date">') else out[:1]
    body = '\n'.join(head + [nav] + out[len(head):])
    return title, body


def main():
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else re.sub(r'\.md$', '.html', src)
    title, body = convert(open(src, encoding='utf-8').read())
    page = (f'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f'<title>{html.escape(title)}</title>\n<style>{CSS}</style>\n</head>\n<body>\n<main>\n{body}\n'
            f'<p class="src">Generated from {html.escape(src.split("/")[-1])} by tools/md_to_html.py.</p>\n</main>\n</body>\n</html>\n')
    open(dst, 'w', encoding='utf-8').write(page)
    print(f'{src} → {dst} ({len(page):,} bytes)')


if __name__ == '__main__':
    main()
