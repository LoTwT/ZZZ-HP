# 生成 ZZZ-HP 首页背景拼贴画 v4
# 构图法则（学 zenless.tools）：一条巨型主字带横贯 + 分层车道 + 单侧幽灵图 + 工具标记点缀
# v4：删除期数编号（静态图不该绑数据）；加危险条纹带/微注记/QR 方块，幽灵图略微提亮
import os
import random
from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps

W, H = 2500, 1080
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # zzz-hp/
REPO = os.path.dirname(ROOT)
OUT = os.path.join(ROOT, 'public/zzz-assets/bg-collage.webp')

base = Image.new('RGBA', (W, H), (0, 0, 0, 255))

def ghost(rel, xy, size, alpha=26, angle=0, tint=(48, 48, 48)):
    p = os.path.join(REPO, rel)
    if not os.path.exists(p):
        print('missing', rel)
        return
    img = Image.open(p).convert('RGBA')
    w, h = img.size
    scale = size / max(w, h)
    img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    if angle:
        img = img.rotate(angle, expand=True, resample=Image.BICUBIC)
    g = ImageOps.grayscale(img)
    g = ImageEnhance.Brightness(g).enhance(0.5)
    colored = ImageOps.colorize(g, black=(0, 0, 0), white=tint).convert('RGBA')
    a = img.getchannel('A').point(lambda v: int(v * alpha / 255))
    colored.putalpha(a)
    base.alpha_composite(colored, xy)

# ── 幽灵图：右侧竖车道（机甲 + 邦布），左上一个 Boss ──
ghost('zzz-hp-backend/boss_image/3114.png', (1900, 120), 640, 34, -5, (54, 54, 54))
ghost('zzz-hp/public/bangboo/snap.webp', (2080, 700), 280, 30, 5, (52, 52, 52))
ghost('zzz-hp-backend/boss_image/1.png', (60, 60), 380, 22, 6, (44, 44, 44))

draw = ImageDraw.Draw(base)
AB = os.path.join(ROOT, 'public/fonts/archivo-black-latin.woff2')
YH = 'C:/Windows/Fonts/msyhbd.ttc'

def text_block(txt, xy, size, fill, font_path=AB, stroke=0, stroke_fill=None, spacing=None):
    f = ImageFont.truetype(font_path, size)
    if spacing is None:
        draw.text(xy, txt, font=f, fill=fill, stroke_width=stroke, stroke_fill=stroke_fill)
    else:
        x, y = xy
        for ch in txt:
            draw.text((x, y), ch, font=f, fill=fill)
            x += draw.textlength(ch, font=f) + spacing

# ── 主字带：巨型 ZZZ-HP 横贯中部（实心 + 错位描边重影） ──
text_block('ZZZ-HP', (-70, 330), 420, (34, 34, 34, 255))
text_block('ZZZ-HP', (-50, 350), 420, (0, 0, 0, 0), stroke=3, stroke_fill=(58, 58, 58, 255))

# ── 顶带 / 底带 ──
text_block('NEW ERIDU', (900, 40), 120, (40, 40, 40, 255))
text_block('FAN TOOLBOX', (80, 960), 130, (38, 38, 38, 255))
text_block('INTER-KNOT', (620, 900), 150, (0, 0, 0, 0), stroke=3, stroke_fill=(50, 50, 50, 255))

# ── 工具标记 ──
# 条码（不带数字编号）
random.seed(7)
bx, by = 620, 800
x = bx
while x < bx + 220:
    w = random.choice([3, 4, 6, 8, 11])
    draw.rectangle([x, by, x + w, by + 56], fill=(52, 52, 52, 255))
    x += w + random.choice([3, 4, 6])

# 微型注记带（车道线下方，等宽小字）
text_block('HOLLOW PROXY NETWORK // FAN TOOLBOX // NEW ERIDU', (620, 740), 30, (54, 54, 54, 255), font_path=YH)

# QR 风格方块（装饰，非真码）
qx, qy, cell = 150, 780, 14
random.seed(21)
for ry in range(7):
    for rx in range(7):
        edge = rx in (0, 6) or ry in (0, 6)
        if edge or random.random() < 0.45:
            draw.rectangle([qx + rx * cell, qy + ry * cell, qx + rx * cell + cell - 3, qy + ry * cell + cell - 3], fill=(40, 40, 40, 255))

# 危险条纹带（左上角色带 + 右下，ZZZ 招牌黄黑斜纹的暗色版）
def hazard(x0, y0, w, h, gap=26, sw=10, color=(46, 46, 46, 255)):
    for i in range(-h, w, gap):
        draw.line([x0 + i, y0 + h, x0 + i + h, y0], fill=color, width=sw)

hazard(60, 200, 340, 60)
hazard(2050, 980, 360, 60)

# 网点补丁
for ox, oy, dw, dh, r, gap in [
    (120, 240, 260, 130, 3, 26),
    (1300, 120, 240, 140, 3, 26),
    (1560, 820, 240, 140, 3, 26),
]:
    for yy in range(oy, oy + dh, gap):
        for xx in range(ox, ox + dw, gap):
            draw.ellipse([xx, yy, xx + r * 2, yy + r * 2], fill=(44, 44, 44, 255))

# ── 细斜线车道 ──
draw.line([0, 300, W, 260], fill=(30, 30, 30, 255), width=6)
draw.line([0, 880, W, 830], fill=(30, 30, 30, 255), width=6)

# ── 整体旋转 -8° ──
base = base.rotate(-8, center=(W / 2, H / 2), resample=Image.BICUBIC, fillcolor=(0, 0, 0, 255))
base.convert('RGB').save(OUT, 'WEBP', quality=82)
print('saved', OUT, os.path.getsize(OUT))
