# -*- coding: utf-8 -*-
"""生成《3.2 式舆防卫战 第2期 数据速览》PPT。

数据来源：线上接口 https://www.zzz-hp.top/api/defense/seasons?variant=new
保存的快照：artifacts/defense_new.json（seasonId 321 = 3.2 第1期，322 = 3.2 第2期）
所有血量数字均由脚本从 JSON 计算，房间血量 = Σ(敌人 hpValue × count)。
"""
import json
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION

SRC = "E:/zzz_HP/artifacts/defense_new.json"
OUT = "E:/zzz_HP/artifacts/3.2防卫战第2期数据速览.pptx"

INK = RGBColor(0x21, 0x25, 0x33)
SUB = RGBColor(0x5A, 0x62, 0x72)
ACCENT = RGBColor(0xE8, 0x62, 0x0D)   # 涨/重点
GOOD = RGBColor(0x0E, 0x8A, 0x6D)     # 降
LINE = RGBColor(0xD8, 0xDC, 0xE4)
HEAD_BG = RGBColor(0x24, 0x2B, 0x3A)
ZEBRA = RGBColor(0xF3, 0xF5, 0xF9)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = "微软雅黑"

with open(SRC, encoding="utf-8") as f:
    seasons = {s["seasonId"]: s for s in json.load(f)["data"]}
s1 = seasons["321"]  # 3.2 第1期
s2 = seasons["322"]  # 3.2 第2期


def room_hp(room):
    return sum(e.get("hpValue", 0) * (e.get("count") or 1)
               for r in room["battleRooms"]
               for w in r["waves"]
               for e in w["enemies"])


def boss_of(room):
    for r in room["battleRooms"]:
        for w in r["waves"]:
            for e in w["enemies"]:
                if e.get("isBoss"):
                    return e
    return None


def enemies_of(room):
    out = []
    for r in room["battleRooms"]:
        for w in r["waves"]:
            for e in w["enemies"]:
                out.append(e)
    return out


def room_weak_res(room):
    weak, res = [], []
    for r in room["battleRooms"]:
        for x in r.get("weakness") or []:
            if x not in weak:
                weak.append(x)
        for x in r.get("resistance") or []:
            if x not in res:
                res.append(x)
    return "、".join(weak) or "—", "、".join(res) or "—"


def buff_text(room):
    b = room.get("roomBuff") or {}
    t = b.get("buffText") or " ".join(b.get("lines") or [])
    return b.get("name") or "—", t


def fmt(n):
    return f"{n:,}"


def pct(a, b):
    """b 相对 a 的变化率，返回 (带符号百分比字符串, 是否下降)"""
    p = (b - a) / a * 100
    return f"{p:+.1f}%", p < 0


rooms1 = s1["frontiers"][0]["rooms"]
rooms2 = s2["frontiers"][0]["rooms"]
total1, total2 = s1["totalHp"], s2["totalHp"]
hp1 = [room_hp(r) for r in rooms1]
hp2 = [room_hp(r) for r in rooms2]
assert sum(hp1) == total1 and sum(hp2) == total2, (sum(hp1), sum(hp2), total1, total2)

bosses1 = [boss_of(r) for r in rooms1]
bosses2 = [boss_of(r) for r in rooms2]

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]


def add_slide():
    return prs.slides.add_slide(BLANK)


def box(slide, x, y, w, h):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    return tf


def para(tf, text, size=14, bold=False, color=INK, first=False, align=PP_ALIGN.LEFT,
         space_after=6, level=0):
    p = tf.paragraphs[0] if first and not tf.paragraphs[0].runs else tf.add_paragraph()
    p.alignment = align
    p.space_after = Pt(space_after)
    p.level = level
    r = p.add_run()
    r.text = text
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.color.rgb = color
    r.font.name = FONT
    return p


def header(slide, title, subtitle=""):
    tf = box(slide, 0.55, 0.32, 12.2, 1.0)
    para(tf, title, 26, True, INK, first=True, space_after=2)
    if subtitle:
        para(tf, subtitle, 13, False, SUB)
    ln = slide.shapes.add_shape(1, Inches(0.58), Inches(1.18), Inches(12.18), Pt(2.4))
    ln.fill.solid()
    ln.fill.fore_color.rgb = ACCENT
    ln.line.fill.background()


def make_table(slide, rows, cols, x, y, w, h, col_widths=None, row_h=0.42, head_h=0.46):
    gt = slide.shapes.add_table(rows, cols, Inches(x), Inches(y), Inches(w), Inches(h))
    table = gt.table
    table.first_row = True
    table.horz_banding = False
    if col_widths:
        total = sum(col_widths)
        for i, cw in enumerate(col_widths):
            table.columns[i].width = Emu(int(Inches(w) * cw / total))
    for r in range(rows):
        table.rows[r].height = Inches(head_h if r == 0 else row_h)
    return table


def cell_set(cell, text, size=12.5, bold=False, color=INK, bg=None, align=PP_ALIGN.CENTER):
    cell.margin_left = Inches(0.06)
    cell.margin_right = Inches(0.06)
    cell.margin_top = Inches(0.02)
    cell.margin_bottom = Inches(0.02)
    cell.vertical_anchor = MSO_ANCHOR.MIDDLE
    if bg is not None:
        cell.fill.solid()
        cell.fill.fore_color.rgb = bg
    tf = cell.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = align
    r = p.add_run()
    r.text = text
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.color.rgb = color
    r.font.name = FONT


# ---------- 第 1 页：封面 ----------
sl = add_slide()
bg = sl.shapes.add_shape(1, Inches(0), Inches(0), prs.slide_width, prs.slide_height)
bg.fill.solid()
bg.fill.fore_color.rgb = HEAD_BG
bg.line.fill.background()
bar = sl.shapes.add_shape(1, Inches(0.9), Inches(2.62), Inches(1.7), Pt(5))
bar.fill.solid()
bar.fill.fore_color.rgb = ACCENT
bar.line.fill.background()
tf = box(sl, 0.9, 1.55, 11.5, 3.6)
para(tf, "3.2 式舆防卫战 · 第2期", 44, True, WHITE, first=True, space_after=14)
para(tf, "数据速览与上期对比", 24, False, RGBColor(0xC9, 0xD2, 0xE0), space_after=26)
para(tf, f"第2期开放时间：{s2['dateRange'].replace(' ', '')}　　第1期：{s1['dateRange'].replace(' ', '')}",
     15, False, RGBColor(0x9A, 0xA6, 0xB8))
tf2 = box(sl, 0.9, 6.35, 11.5, 0.7)
para(tf2, "数据来源：zzz-hp.top 防卫战数据库（seasonId 321 / 322）　·　生成日期：2026-10-02",
     12, False, RGBColor(0x8A, 0x94, 0xA6), first=True)

# ---------- 第 2 页：总血量与各房间血量 ----------
sl = add_slide()
header(sl, "一、总血量与各房间血量变化（对比 3.2 第1期）",
       "房间血量 = 房间内全部敌人血量之和；两期均为第五防线（3 条房间，等级 70）")

t1, t2 = total1, total2
tp, tdown = pct(t1, t2)
rows = [
    ("", "3.2 第1期", "3.2 第2期", "变化量", "变化率"),
    ("总血量", fmt(t1), fmt(t2), f"{t2 - t1:+,}", tp),
]
for i in range(3):
    d, dp = pct(hp1[i], hp2[i])
    rows.append((f"房间 {i + 1}", fmt(hp1[i]), fmt(hp2[i]), f"{hp2[i] - hp1[i]:+,}", d))

table = make_table(sl, 5, 5, 0.55, 1.55, 7.3, 2.6, col_widths=[1.4, 1.7, 1.7, 1.5, 1.1])
for j, txt in enumerate(rows[0]):
    cell_set(table.cell(0, j), txt, 13, True, WHITE, HEAD_BG)
for i, row in enumerate(rows[1:], start=1):
    bold = i == 1
    bgc = ZEBRA if i % 2 == 0 else WHITE
    for j, txt in enumerate(row):
        color = INK
        if j == 4:
            color = GOOD if row[-1].startswith("-") else ACCENT
        if j == 3:
            color = GOOD if txt.startswith("-") else ACCENT
        cell_set(table.cell(i, j), txt, 12.5, bold or j in (3, 4), color, bgc,
                 PP_ALIGN.LEFT if j == 0 else PP_ALIGN.CENTER)

tf = box(sl, 0.55, 4.55, 7.3, 2.4)
para(tf, "要点", 14, True, INK, first=True, space_after=4)
para(tf, f"· 总血量 {tp}（{t2 - t1:+,}），本期整体变轻，主要来自房间 3 血量大幅下调", 13, color=INK, space_after=4)
para(tf, f"· 房间 1 {pct(hp1[0], hp2[0])[0]}、房间 2 {pct(hp1[1], hp2[1])[0]}，小怪与精英怪数量更多、更吃清杂能力", 13, space_after=4)
para(tf, f"· 房间 3 {pct(hp1[2], hp2[2])[0]}，为总血量下降的主因", 13, space_after=4)

# 柱状图
cd = CategoryChartData()
cd.categories = ["总血量", "房间1", "房间2", "房间3"]
cd.add_series("3.2 第1期", (t1 / 1e4, hp1[0] / 1e4, hp1[1] / 1e4, hp1[2] / 1e4))
cd.add_series("3.2 第2期", (t2 / 1e4, hp2[0] / 1e4, hp2[1] / 1e4, hp2[2] / 1e4))
gf = sl.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(8.15), Inches(1.55),
                         Inches(4.65), Inches(5.3), cd)
ch = gf.chart
ch.has_title = False
ch.has_legend = True
ch.legend.position = XL_LEGEND_POSITION.BOTTOM
ch.legend.include_in_layout = False
ch.legend.font.size = Pt(11)
ch.legend.font.name = FONT
pl = ch.plots[0]
pl.gap_width = 80
pl.has_data_labels = True
pl.data_labels.font.size = Pt(9)
pl.data_labels.font.name = FONT
pl.data_labels.number_format = '#,##0"万"'
pl.data_labels.number_format_is_linked = False
for s, c in zip(ch.series, (RGBColor(0x8E, 0x9A, 0xAE), ACCENT)):
    s.format.fill.solid()
    s.format.fill.fore_color.rgb = c
va = ch.value_axis
va.has_major_gridlines = True
va.tick_labels.font.size = Pt(10)
va.tick_labels.number_format = '#,##0'
va.tick_labels.number_format_is_linked = False
ch.category_axis.tick_labels.font.size = Pt(11)
tf = box(sl, 8.15, 6.55, 4.7, 0.4)
para(tf, "纵轴与数值标签单位：万", 10, False, SUB, first=True)

# ---------- 第 3 页：Boss 血量变化 ----------
sl = add_slide()
header(sl, "二、Boss 血量变化（三间房 Boss 全部更换）",
       "本期 Boss 单体血量全线下调，杂兵/精英怪占比明显上升")

rows = [("房间", "上期 Boss（3.2 第1期）", "血量", "本期 Boss（3.2 第2期）", "血量", "变化率")]
b1h, b2h = [], []
for i in range(3):
    b1, b2 = bosses1[i], bosses2[i]
    b1h.append(b1["hpValue"])
    b2h.append(b2["hpValue"])
    bp, _ = pct(b1["hpValue"], b2["hpValue"])
    rows.append((f"房间 {i + 1}", b1["name"], fmt(b1["hpValue"]), b2["name"], fmt(b2["hpValue"]), bp))

table = make_table(sl, 4, 6, 0.55, 1.5, 12.2, 2.35,
                   col_widths=[0.9, 2.5, 1.7, 2.5, 1.7, 1.1])
for j, txt in enumerate(rows[0]):
    cell_set(table.cell(0, j), txt, 13, True, WHITE, HEAD_BG)
for i, row in enumerate(rows[1:], start=1):
    bgc = ZEBRA if i % 2 == 0 else WHITE
    for j, txt in enumerate(row):
        color = GOOD if (j == 5 and txt.startswith("-")) else INK
        cell_set(table.cell(i, j), txt, 12.5, j in (0, 5), color, bgc,
                 PP_ALIGN.LEFT if j in (1, 3) else PP_ALIGN.CENTER)

bt1, bt2 = sum(b1h), sum(b2h)
btp, _ = pct(bt1, bt2)
tf = box(sl, 0.55, 4.25, 12.2, 2.7)
para(tf, "要点", 14, True, INK, first=True, space_after=4)
para(tf, f"· 三名 Boss 血量全部下降：{pct(b1h[0], b2h[0])[0]} / {pct(b1h[1], b2h[1])[0]} / {pct(b1h[2], b2h[2])[0]}；"
         f"Boss 合计 {fmt(bt1)} → {fmt(bt2)}（{btp}）", 13, space_after=4)
para(tf, "· 房间 3 Boss「幻矢单元 → 多佩冈亚·星徽·比利」下调幅度最大（约 -28%），失衡时间 12 秒 → 7 秒，更快但也更难打满失衡窗口", 13, space_after=4)
para(tf, "· 杂兵与精英怪总血量：房间1 约 966万 → 1508万、房间2 约 1164万 → 1870万、房间3 约 1245万 → 1017万，前两间清杂压力显著上升", 13, space_after=4)
para(tf, "· 结论：本期难度重心从「单 Boss 长线输出」转向「前两间清杂 + Boss 速杀」", 13, True, ACCENT, space_after=4)

# ---------- 第 4 页：Buff 情况 ----------
sl = add_slide()
header(sl, "三、Buff 情况（关卡增益逐房间对比）", "上期围绕锐化 / 异常 / 以太，本期改为连携击破 / 冰以太 / 火电爆发")

colw = 3.95
titles = ["房间 1", "房间 2", "房间 3"]
for i in range(3):
    n1, txt1 = buff_text(rooms1[i])
    n2, txt2 = buff_text(rooms2[i])
    x = 0.55 + i * (colw + 0.18)
    tf = box(sl, x, 1.42, colw, 0.4)
    para(tf, titles[i], 15, True, ACCENT, first=True)
    tf = box(sl, x, 1.82, colw, 5.1)
    para(tf, f"上期：{n1}", 12.5, True, SUB, first=True, space_after=3)
    for seg in txt1.replace("。", "。\n").split("\n"):
        if seg.strip():
            para(tf, seg.strip(), 11.5, color=SUB, space_after=2)
    para(tf, "", 6, space_after=2)
    para(tf, f"本期：{n2}", 12.5, True, INK, space_after=3)
    for seg in txt2.replace("。", "。\n").split("\n"):
        if seg.strip():
            para(tf, seg.strip(), 11.5, color=INK, space_after=2)

tf = box(sl, 0.55, 6.9, 12.2, 0.5)
para(tf, "数值上本期房间 3「焚烬启明」（火/电伤害 +35%）为三间最高；三间增益均绑定失衡/异常交互，击破与异常角色通用性更好。",
     12, True, INK, first=True)

# ---------- 第 5 页：弱点情况 ----------
sl = add_slide()
header(sl, "四、弱点情况（Boss 弱点 / 抗性）", "三间房 Boss 全部抗物理，弱点转向 电 / 风 / 冰 / 火")

rows = [("房间", "本期 Boss", "弱点", "抗性", "上期 Boss", "弱点", "抗性")]
for i in range(3):
    b2, b1 = bosses2[i], bosses1[i]
    rows.append((f"房间 {i + 1}", b2["name"], (b2.get("weakness") or "—").replace(" ", "、"),
                 (b2.get("resistance") or "—"), b1["name"],
                 (b1.get("weakness") or "—").replace(" ", "、"),
                 (b1.get("resistance") or "—")))

table = make_table(sl, 4, 7, 0.55, 1.5, 12.2, 2.35,
                   col_widths=[0.85, 2.15, 1.45, 1.05, 2.15, 1.45, 1.05])
for j, txt in enumerate(rows[0]):
    cell_set(table.cell(0, j), txt, 13, True, WHITE, HEAD_BG)
for i, row in enumerate(rows[1:], start=1):
    bgc = ZEBRA if i % 2 == 0 else WHITE
    for j, txt in enumerate(row):
        color = INK
        if j in (2, 5):
            color = RGBColor(0x0B, 0x5F, 0xA8)
        if j in (3, 6):
            color = RGBColor(0xB0, 0x3A, 0x2B)
        cell_set(table.cell(i, j), txt, 12, j == 0, color, bgc,
                 PP_ALIGN.LEFT if j in (1, 4) else PP_ALIGN.CENTER)

tf = box(sl, 0.55, 4.25, 12.2, 2.7)
para(tf, "要点", 14, True, INK, first=True, space_after=4)
para(tf, "· 本期三名 Boss 全部抗物理（上期三名 Boss 无一抗物理），物理主 C 本期全面受损", 13, True, ACCENT, space_after=4)
para(tf, "· 弱点覆盖：电（房间1 征服者）、冰（房间2 狛野真斗）、火/电（房间3 比利）；小怪层弱点以 火/风/电 为主", 13, space_after=4)
para(tf, "· 杂兵抗性很少（非 Boss 敌人仅拉赫穆抗物理、多佩冈亚·波可娜抗冰），非物理属性队伍基本不受抗性限制", 13, space_after=4)
para(tf, "· 上期三名 Boss 抗性为 以太/电/火，无一抗物理；本期弱点全面换血，与房间增益（火电/冰以太）互相呼应", 13, space_after=4)

# ---------- 第 6 页：小结 ----------
sl = add_slide()
header(sl, "小结：3.2 第2期相比第1期怎么打")
items = [
    ("更轻但更散", f"总血量 {tp}，Boss 合计 {btp}；但前两间杂兵血量 +56% / +61%，需要带清杂位。"),
    ("物理队避雷", "三名 Boss 全部抗物理，本期主 C 优先选 电 / 火 / 冰 / 风属性。"),
    ("增益吃操作", "三间增益都绑定失衡/异常触发（易伤倍率 +20~30%、防 -10%），击破位和异常位收益高。"),
    ("速杀窗口变短", "房间 3 Boss 失衡时间 7 秒（上期 12 秒），爆发期要卡在失衡窗口内。"),
]
for i, (t, d) in enumerate(items):
    y = 1.55 + i * 1.32
    card = sl.shapes.add_shape(1, Inches(0.55), Inches(y), Inches(12.2), Inches(1.12))
    card.fill.solid()
    card.fill.fore_color.rgb = ZEBRA if i % 2 else WHITE
    card.line.color.rgb = LINE
    card.line.width = Pt(0.75)
    tf = box(sl, 0.85, y + 0.12, 11.6, 0.9)
    para(tf, f"{i + 1}. {t}", 15, True, ACCENT, first=True, space_after=2)
    para(tf, d, 13, color=INK)

prs.save(OUT)
print("saved:", OUT)
