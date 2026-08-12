#!/usr/bin/env python3
"""Merge paired zh/_en pages into single dual-language HTML files.

Structure produced:
  <body>
    <div class="container">
      <nav>... language switch buttons ...</nav>
      <div lang="zh"> ...zh content (hero + cards + footer)... </div>
      <div lang="en" hidden> ...en content... </div>
    </div>
    <script> language switcher </script>
  </body>

Run from repo root: python3 scripts/merge_lang.py
"""
import re, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')

LANG_SCRIPT = '''<script>
(function () {
  var KEY = 'browsebuddy_lang';
  function getLang() {
    var p = new URLSearchParams(window.location.search).get('lang');
    if (p === 'zh' || p === 'en') return p;
    try { var s = localStorage.getItem(KEY); if (s === 'zh' || s === 'en') return s; } catch (e) {}
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  function apply(lang) {
    document.querySelectorAll('[lang="zh"], [lang="en"]').forEach(function (el) {
      el.hidden = el.getAttribute('lang') !== lang;
    });
    document.querySelectorAll('[data-lang-switch]').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-lang-switch') === lang);
    });
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    try { localStorage.setItem(KEY, lang); } catch (e) {}
  }
  document.addEventListener('DOMContentLoaded', function () {
    apply(getLang());
    document.querySelectorAll('[data-lang-switch]').forEach(function (el) {
      el.addEventListener('click', function () { apply(el.getAttribute('data-lang-switch')); });
    });
  });
})();
</script>'''

def extract(s, tag):
    return re.search(f'<{tag}>(.*?)</{tag}>', s, re.DOTALL).group(1)

def build_dual(name):
    zh = open(os.path.join(DOCS, f'{name}.html')).read()
    en = open(os.path.join(DOCS, f'{name}_en.html')).read()
    style = extract(zh, 'style')
    zh_body = extract(zh, 'body')
    en_body = extract(en, 'body')

    # Build nav with language switch buttons (replace the old lang-pill link)
    nav_zh = re.search(r'<nav class="nav">.*?</nav>', zh_body, re.DOTALL).group(0)
    nav_en = re.search(r'<nav class="nav">.*?</nav>', en_body, re.DOTALL).group(0)

    # The nav contains a lang-pill <a>; replace with data-lang-switch buttons.
    def fix_nav(nav, self_lang, other_lang):
        # Remove existing lang pill link
        nav = re.sub(r'<span class="lang-pill">.*?</span>', '', nav, flags=re.DOTALL)
        # Insert language switch buttons at the end of nav-links
        nav = nav.replace('</div>\n        </nav>', '')
        nav = nav.replace('</div>\n    </nav>', '')
        nav = nav.replace('</div>\n</nav>', '')
        # Find the closing of nav-links div
        nav = re.sub(r'(</div>\s*)(</nav>)',
                     r'<span class="lang-pill"><button data-lang-switch="zh" class="lang-btn\1' + (' active"') + '>中文</button> <button data-lang-switch="en" class="lang-btn">English</button></span>\2',
                     nav, count=1)
        return nav

    # Simpler: strip navs entirely, we'll craft one canonical nav per page.
    zh_body = re.sub(r'<nav class="nav">.*?</nav>', '', zh_body, flags=re.DOTALL)
    en_body = re.sub(r'<nav class="nav">.*?</nav>', '', en_body, flags=re.DOTALL)

    # Extract footer from both
    zh_footer = re.search(r'<footer>.*?</footer>', zh_body, re.DOTALL).group(0)
    en_footer = re.search(r'<footer>.*?</footer>', en_body, re.DOTALL).group(0)

    # Remove footers from bodies (they'll be placed per-lang inside div)
    zh_body = zh_body.replace(zh_footer, '')
    en_body = en_body.replace(en_footer, '')

    # Canonical nav with language buttons
    nav = f'''<nav class="nav">
            <a class="nav-brand" href="index.html">
                <img src="icon.png" alt="BrowseBuddy">
                <span>BrowseBuddy</span>
            </a>
            <div class="nav-links">
                <a href="index.html">{'Home'}</a>
                <span class="lang-pill">
                    <button data-lang-switch="zh" class="lang-btn">中文</button>
                    <button data-lang-switch="en" class="lang-btn">English</button>
                </span>
            </div>
        </nav>'''

    # Build final doc. Language-specific home/links differ; we keep generic ones
    # that work for both (index.html is the shared page now).
    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BrowseBuddy</title>
    <style>
        {style}
        .lang-btn {{
            background: none; border: none; color: #a0a0b5; cursor: pointer;
            font-size: 0.9em; padding: 7px 12px; border-radius: 9px; transition: all 0.2s;
        }}
        .lang-btn:hover {{ color: #eaeaf2; background: rgba(255,255,255,0.08); }}
        .lang-btn.active {{ color: #fff; background: rgba(99,102,241,0.35); }}
        .lang-pill {{ display: inline-flex; gap: 4px; margin-left: 8px;
            background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.3); border-radius: 9px; }}
    </style>
</head>
<body>
    <div class="container">
        {nav}
        <div lang="zh">{zh_body}
        {zh_footer}
        </div>
        <div lang="en" hidden>{en_body}
        {en_footer}
        </div>
    </div>
    {LANG_SCRIPT}
</body>
</html>'''
    out = os.path.join(DOCS, f'{name}.html')
    open(out, 'w').write(html)
    print(f'✓ {name}.html ({len(html)} bytes)')

if __name__ == '__main__':
    for n in ['privacy', 'permissions', 'terms']:
        build_dual(n)
    print('Done. Home page (index) handled separately.')
