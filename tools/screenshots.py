# README 用のスクリーンショットを撮り直す（docs/screenshots/ に保存）
#   pip install playwright && python -m playwright install chromium
#   npm pack @fontsource/biz-udpgothic @fontsource/ibm-plex-mono  → 展開したフォルダを FONT_DIR に置く
#   python -m http.server 8765   （リポジトリのルートで起動しておく）
#   python tools/screenshots.py [FONT_DIR]
# 画面と同じ字体（BIZ UDPGothic・IBM Plex Mono）で撮るため、Google Fonts への要求を手元のフォントで返す
import sys, re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'screenshots'
FONT_DIR = Path(sys.argv[1] if len(sys.argv) > 1 else 'fonts')
URL = 'http://localhost:8765/index.html'

def font_css():
    css = ''
    for pkg, files in [('biz-udpgothic', ['400.css', '700.css']), ('ibm-plex-mono', ['500.css'])]:
        base = next(FONT_DIR.glob(f'fontsource-{pkg}-*/package'))
        for f in files:
            css += re.sub(r'url\(\./files/([^)]+)\)', lambda m: f'url(https://fonts.local/{pkg}/{m.group(1)})', (base / f).read_text(encoding='utf-8'))
    return css

def route_fonts(page):
    css = font_css()
    page.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=css))
    def serve(r):
        pkg, name = r.request.url.split('https://fonts.local/')[1].split('/', 1)
        path = next(FONT_DIR.glob(f'fontsource-{pkg}-*/package/files')) / name
        r.fulfill(status=200, content_type='font/woff2' if name.endswith('woff2') else 'font/woff', body=path.read_bytes())
    page.route('https://fonts.local/**', serve)

def shoot(page, selector, path, height):
    # 結果の表が切れないよう、撮影時だけ本文の最大幅を広げる
    page.add_style_tag(content='header.top{position:static!important}.wrap,.top-in{max-width:1280px!important}')
    page.mouse.move(0, 0)
    page.evaluate('document.fonts.ready')
    y = page.locator(selector).bounding_box()['y'] + page.evaluate('scrollY')
    page.screenshot(path=str(path), full_page=True, clip={'x': 0, 'y': y - 10, 'width': 1280, 'height': height})

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    route_fonts(pg)
    pg.goto(URL); pg.wait_for_load_state('networkidle')
    pg.click('#sampleBtn'); pg.wait_for_selector('#targetChips input')
    for t in 'ABC': pg.check(f'#targetChips input[value="{t}"]')
    pg.check('#sameSpec'); pg.fill('#specBody input[data-k="usl"]', '1.3'); pg.fill('#specBody input[data-k="lsl"]', '-0.3')
    pg.click('#runCap'); pg.wait_for_selector('#summary table'); pg.wait_for_timeout(500)
    # 字体が読み込まれる前に描いたグラフを描き直す
    pg.evaluate('document.fonts.ready'); pg.click('#themeBtn'); pg.click('#themeBtn'); pg.click('#themeBtn')
    shoot(pg, '#capResult', OUT / 'capability.png', 1250)
    pg.click('nav.tabs button[data-tab="test"]'); pg.select_option('#tKind', 'welch'); pg.check('#doOverlay')
    pg.click('#runTest'); pg.wait_for_selector('#testCards .res'); pg.wait_for_timeout(500)
    shoot(pg, '#testResult', OUT / 'test.png', 900)
    # 画面で入力（新しいページで、保存済みのデータがない状態から）
    pg2 = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
    route_fonts(pg2)
    pg2.goto(URL); pg2.wait_for_load_state('networkidle')
    pg2.click('#srcSeg button[data-v="grid"]'); pg2.wait_for_selector('#gridWrap input[data-r="0"]')
    tsv = 'ロット\t外径\t長さ\n' + '\n'.join(f'L{1 + i // 5:02d}\t{10 + ((i * 7) % 9 - 4) * 0.006:.3f}\t{50 + ((i * 5) % 7 - 3) * 0.02:.2f}' for i in range(30))
    pg2.click('#gridWrap input[data-r="0"][data-c="0"]')
    pg2.evaluate("""t => { const el = document.activeElement; const dt = new DataTransfer(); dt.setData('text/plain', t); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }""", tsv)
    pg2.wait_for_timeout(600)
    pg2.fill('#specBody input[data-t="外径"][data-k="draw"]', 'φ10 +0.05/-0.03'); pg2.fill('#specBody input[data-t="長さ"][data-k="draw"]', '50±0.15')
    pg2.evaluate('document.querySelector("#gridWrap").scrollTop = 0'); pg2.mouse.move(0, 0)
    pg2.add_style_tag(content='header.top{position:static!important}.wrap,.top-in{max-width:1280px!important}.grid-wrap{max-height:330px!important}')
    y = pg2.locator('#dataSec').bounding_box()['y'] + pg2.evaluate('scrollY')
    y2 = pg2.locator('#capSetup').bounding_box(); h = y2['y'] + y2['height'] + pg2.evaluate('scrollY') - y + 20
    pg2.screenshot(path=str(OUT / 'input.png'), full_page=True, clip={'x': 0, 'y': y - 10, 'width': 1280, 'height': h})
    b.close()
print('docs/screenshots/ に保存しました')
