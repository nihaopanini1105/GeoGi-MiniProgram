import json
import os
import sys
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


PAGE_W, PAGE_H = A4
BLUE = colors.HexColor("#1768ff")
DARK = colors.HexColor("#0d1b4c")
MUTED = colors.HexColor("#5f6f91")
LINE = colors.HexColor("#dbe4f2")
BG = colors.HexColor("#f5f8ff")
GREEN = colors.HexColor("#2dc38a")
RED = colors.HexColor("#ef4b4b")
ORANGE = colors.HexColor("#f59b28")
REPORT_PLATFORMS = ["豆包", "元宝", "千问", "DeepSeek", "Kimi"]
FONT_NAME = "GeoGiCJK"
FONT_CANDIDATES = [
    os.environ.get("REPORT_FONT_PATH", ""),
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]


def main():
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    register_font()
    c = canvas.Canvas(output_path, pagesize=A4)
    c.setTitle(f"{text(data.get('form', {}).get('brandName'))} GeoGi AI可见度诊断报告")

    draw_cover(c, data)
    draw_summary(c, data)
    draw_metrics(c, data)
    draw_platforms(c, data)
    draw_platform_details(c, data)
    draw_actions(c, data)
    c.save()


def register_font():
    for font_path in FONT_CANDIDATES:
        if not font_path:
            continue
        try:
            pdfmetrics.registerFont(TTFont(FONT_NAME, font_path))
            return
        except Exception:
            continue
    raise RuntimeError("未找到可嵌入的中文字体，请在服务器安装 Arial Unicode 或配置中文TTF字体。")


def draw_cover(c, data):
    form = data.get("form", {})
    report = data.get("report", {})
    brand = text(form.get("brandName")) or "品牌"
    score = score_overall(data)

    c.setFillColor(BLUE)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#0b2c76"))
    c.rect(0, 0, PAGE_W, 260, fill=1, stroke=0)
    c.setStrokeColor(colors.Color(1, 1, 1, alpha=0.24))
    c.setLineWidth(1.2)
    c.circle(PAGE_W - 95, PAGE_H - 230, 165, fill=0, stroke=1)

    c.setFillColor(colors.white)
    rounded_rect(c, 40, PAGE_H - 76, 28, 28, 8, colors.white, colors.white)
    c.setFillColor(BLUE)
    c.circle(54, PAGE_H - 62, 8, fill=0, stroke=1)
    c.setFont("GeoGiCJK", 13)
    c.setFillColor(colors.white)
    c.drawString(78, PAGE_H - 56, "GeoGi 几何智引")
    c.setFont("GeoGiCJK", 8)
    c.drawString(78, PAGE_H - 72, "AI 可见度增长")

    c.setFont("GeoGiCJK", 12)
    c.drawString(40, PAGE_H - 198, "AI Visibility Diagnosis")
    c.setFont("GeoGiCJK", 29)
    c.drawString(40, PAGE_H - 248, brand)
    c.drawString(40, PAGE_H - 288, "AI 可见度诊断报告")
    c.setFont("GeoGiCJK", 11)
    c.drawString(40, PAGE_H - 322, "品牌画像 / GEO数值分析 / 平台问答证据 / 优化建议")

    rounded_rect(c, PAGE_W - 160, PAGE_H - 520, 72, 72, 18, colors.white, colors.white)
    c.setFillColor(score_color(score))
    c.setFont("GeoGiCJK", 25)
    c.drawCentredString(PAGE_W - 124, PAGE_H - 486, str(score))
    c.setFont("GeoGiCJK", 8)
    c.setFillColor(MUTED)
    c.drawCentredString(PAGE_W - 124, PAGE_H - 504, "/ 100")
    c.setFillColor(DARK)
    c.drawCentredString(PAGE_W - 124, PAGE_H - 514, score_level(score))

    y = 92
    rounded_rect(c, 40, y, PAGE_W - 80, 166, 16, colors.HexColor("#f8fbff"), colors.HexColor("#f8fbff"))
    rows = [
        ("客户品牌", brand),
        ("所属行业", f"{text(form.get('industry'))} / {text(form.get('segment'))}"),
        ("核心业务", limit(text(form.get("offerings")), 34)),
        ("目标市场", limit("、".join(form.get("targetMarket") or []) or "待确认", 34)),
        ("检测平台", platform_names(data)),
        ("项目编号", text(data.get("projectId"))),
    ]
    y0 = y + 135
    for idx, row in enumerate(rows):
        c.setFont("GeoGiCJK", 8)
        c.setFillColor(BLUE)
        c.drawString(58, y0 - idx * 22, row[0])
        c.setFillColor(DARK)
        c.drawString(118, y0 - idx * 22, row[1])
        if idx < len(rows) - 1:
            c.setStrokeColor(LINE)
            c.line(58, y0 - idx * 22 - 10, PAGE_W - 58, y0 - idx * 22 - 10)

    c.setFont("GeoGiCJK", 8)
    c.setFillColor(colors.Color(1, 1, 1, alpha=0.62))
    c.drawString(40, 44, f"正式快检版 · {date_text(data.get('testedAt'))} · GeoGi 品牌 AI 可见度诊断")
    c.showPage()


def draw_summary(c, data):
    form = data.get("form", {})
    brand = text(form.get("brandName")) or "品牌"
    score = score_overall(data)
    header(c, "Executive Summary")
    section_label(c, "01 / 总览结论", 650)
    title(c, f"{brand}的 AI 可见度已形成可诊断样本", 620)
    paragraph(c, 40, 590, "本页结论来自客户资料、品牌档案、5 个 AI 平台问答记录与结构化表格/链接/图片证据。GeoGi 关注的是用户真实提问时，AI 是否能识别品牌、主动推荐、准确表达并给出可信信源。", 510)

    rounded_rect(c, 40, 450, 515, 100, 14, colors.white, LINE)
    c.setFillColor(BLUE)
    c.setFont("GeoGiCJK", 10)
    c.drawString(58, 522, "一句话结论")
    c.setFillColor(DARK)
    paragraph(
        c,
        58,
        494,
        f"{brand}已有一定 AI 可见度基础，下一步应围绕品牌实体、产品卖点、可信信源和推荐理由做系统补强。",
        470,
        size=12,
        leading=18,
        color=DARK
    )

    metric_cards(c, 40, 362, [
        ("综合可见度", f"{score}/100", score_level(score)),
        ("测试问答", str(len(data.get("conversations") or [])), "跨平台样本"),
        ("平台覆盖", platform_coverage_text(data), "数据校验"),
    ])

    draw_bullets(c, 58, 288, "数据复核", [
        quality_line(data),
        "若某个平台读取条数超过 6 条，GeoGi 会把额外内容并入同平台证据，不额外计为检测问题。",
        "若某个平台回答正文缺失，报告会标记为待补充，不把缺失数据当成有效结论。"
    ])

    draw_bullets(c, 58, 178, "专业判断", [
        "AI 搜索环境下，品牌不只是“被提到”，还要被准确解释、被主动推荐、被可信证据支撑。",
        "GeoGi 的优势在于把用户真实问题、平台答案、信源证据和优化任务放在一个工作流里闭环。",
        "相比只给关键词或泛化建议的 GEO 服务，本报告保留每个平台的原始问答证据，便于复核和交付。"
    ])
    footer(c, 2)


def draw_metrics(c, data):
    header(c, "GEO Metrics")
    section_label(c, "02 / GEO 数值分析", 650)
    title(c, "识别、推荐、准确、信源四类指标联合判断", 620)
    paragraph(c, 40, 590, "GeoGi 将每条平台回答拆分为可复核的诊断单元。分数不是单纯曝光率，而是同时考虑品牌是否出现、是否被主动推荐、信息是否准确，以及答案是否有可信来源。", 510)

    metrics = [
        ("品牌识别度", score_dimension(data, "品牌识别得分"), "AI 能否正确识别品牌主体、业务和适用场景"),
        ("主动推荐度", score_dimension(data, "主动推荐得分"), "用户没有点名品牌时，是否进入推荐候选"),
        ("信息准确度", score_dimension(data, "信息准确得分"), "产品、优势、市场、服务边界是否表达准确"),
        ("信源可信度", source_score(data), "是否引用官方、第三方、用户评价或行业信源"),
    ]
    y = 520
    for name, score, desc in metrics:
        score_bar(c, 58, y, name, score, desc)
        y -= 74

    draw_bullets(c, 58, 190, "GeoGi 方法优势", [
        "以真实用户提问为入口，避免只看品牌词搜索导致的虚高判断。",
        "把 Kimi 等平台的表格型回答也纳入诊断，表格内容不会被忽略。",
        "结果同时沉淀到飞书工作台和客户 PDF，方便内部复核与客户交付。"
    ])
    footer(c, 3)


def draw_platforms(c, data):
    header(c, "Platform Evidence")
    section_label(c, "03 / 平台表现与证据", 650)
    title(c, "五个平台按同一组检测问题对齐分析", 620)
    grouped = {}
    for item in data.get("conversations") or []:
        platform = canonical_platform(text(item.get("platform"))) or "未标注平台"
        grouped.setdefault(platform, []).append(item)

    y = 560
    for platform in REPORT_PLATFORMS:
        items = grouped.get(platform, [])
        stat = platform_stat(data, platform)
        mentioned = sum(1 for item in items if contains_brand(item, data.get("form", {})))
        rounded_rect(c, 40, y - 52, 515, 58, 12, colors.white, LINE)
        c.setFillColor(DARK)
        c.setFont("GeoGiCJK", 13)
        c.drawString(58, y - 16, platform)
        c.setFillColor(MUTED)
        c.setFont("GeoGiCJK", 9)
        expected = int(stat.get("expected") or 6)
        raw = int(stat.get("raw") or len(items))
        answered = int(stat.get("answered") or 0)
        c.drawString(150, y - 16, f"问答 {len(items)}/{expected} 条 · 有效回答 {answered} 条 · 提到品牌 {mentioned} 条")
        sample = text(items[0].get("question")) if items else "该平台检测问题待补充"
        status = "数据已对齐" if len(items) == expected else f"原始读取 {raw} 条，需复核"
        paragraph(c, 58, y - 34, f"{status}｜代表问题：{sample}", 440, size=8, leading=11)
        y -= 74

    footer(c, 4)


def draw_platform_details(c, data):
    header(c, "Evidence Review")
    section_label(c, "04 / 关键证据复核", 650)
    title(c, "从平台回答中提炼可交付判断", 620)
    analyses_by_platform = {}
    for item in data.get("analyses") or []:
        platform = canonical_platform(text(item.get("平台"))) or "未标注平台"
        analyses_by_platform.setdefault(platform, []).append(item)

    y = 548
    for platform in REPORT_PLATFORMS:
        items = analyses_by_platform.get(platform) or []
        issue = first_text(items, "核心问题") or "该平台回答正文不足，暂不能形成正式判断。"
        advice = first_text(items, "优化建议") or "补充该平台完整回答后，再复核品牌识别、推荐理由和信源可信度。"
        rounded_rect(c, 40, y - 78, 515, 88, 12, colors.white, LINE)
        c.setFillColor(BLUE)
        c.setFont("GeoGiCJK", 11)
        c.drawString(58, y - 12, platform)
        paragraph(c, 58, y - 32, f"发现：{issue}", 472, size=8, leading=11)
        paragraph(c, 58, y - 58, f"建议：{advice}", 472, size=8, leading=11)
        y -= 96

    footer(c, 5)


def draw_actions(c, data):
    form = data.get("form", {})
    brand = text(form.get("brandName")) or "品牌"
    header(c, "Optimization Roadmap")
    section_label(c, "05 / 优化建议", 650)
    title(c, f"{brand}应优先补强可被 AI 引用的品牌证据", 620)
    advice = recommendations(data)
    y = 548
    for idx, item in enumerate(advice[:5], start=1):
        rounded_rect(c, 40, y - 48, 515, 58, 12, colors.white, LINE)
        c.setFillColor(BLUE)
        c.setFont("GeoGiCJK", 13)
        c.drawString(58, y - 18, f"0{idx}")
        paragraph(c, 96, y - 12, item, 410, size=9, leading=13)
        y -= 72

    rounded_rect(c, 40, 88, 515, 90, 14, colors.HexColor("#fff7eb"), colors.HexColor("#ffd398"))
    c.setFillColor(ORANGE)
    c.setFont("GeoGiCJK", 10)
    c.drawString(58, 148, "交付说明")
    paragraph(c, 58, 128, "本报告用于基础快检和方向判断。正式 GEO 增长服务会进一步补充官网内容、结构化问答、第三方信源、平台适配素材和周期性复测。", 470, size=9, leading=14)
    footer(c, 6)


def header(c, right):
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(BLUE)
    rounded_rect(c, 40, PAGE_H - 72, 18, 18, 5, BLUE, BLUE)
    c.setFillColor(DARK)
    c.setFont("GeoGiCJK", 11)
    c.drawString(66, PAGE_H - 55, "GeoGi 几何智引")
    c.setFont("GeoGiCJK", 8)
    c.setFillColor(MUTED)
    c.drawString(66, PAGE_H - 69, "AI 可见度增长")
    c.drawRightString(PAGE_W - 40, PAGE_H - 58, right)
    c.setStrokeColor(LINE)
    c.line(40, PAGE_H - 90, PAGE_W - 40, PAGE_H - 90)


def footer(c, page):
    c.setStrokeColor(LINE)
    c.line(40, 42, PAGE_W - 40, 42)
    c.setFillColor(MUTED)
    c.setFont("GeoGiCJK", 8)
    c.drawString(40, 24, "GeoGi 几何智引 · 让品牌在 AI 时代被看见、被理解、被选择")
    c.drawRightString(PAGE_W - 40, 24, f"{page:02d}")
    c.showPage()


def section_label(c, value, y):
    c.setFillColor(BLUE)
    c.setFont("GeoGiCJK", 9)
    c.drawString(40, y, value)


def title(c, value, y):
    c.setFillColor(DARK)
    c.setFont("GeoGiCJK", 22)
    for i, line in enumerate(wrap_to_width(value, PAGE_W - 80, 22)[:2]):
        c.drawString(40, y - i * 28, line)


def paragraph(c, x, y, value, width, size=9, leading=14, color=MUTED):
    c.setFillColor(color)
    c.setFont("GeoGiCJK", size)
    for i, line in enumerate(wrap_to_width(value, width, size)):
        c.drawString(x, y - i * leading, line)


def draw_bullets(c, x, y, heading, items):
    c.setFillColor(DARK)
    c.setFont("GeoGiCJK", 13)
    c.drawString(x, y, heading)
    c.setFont("GeoGiCJK", 9)
    for idx, item in enumerate(items):
        yy = y - 28 - idx * 28
        c.setFillColor(GREEN)
        c.circle(x + 4, yy + 4, 1.8, fill=1, stroke=0)
        c.setFillColor(MUTED)
        c.drawString(x + 14, yy, limit(item, 76))


def metric_cards(c, x, y, items):
    w = 160
    for idx, (label, value, desc) in enumerate(items):
        xx = x + idx * 178
        rounded_rect(c, xx, y, w, 74, 12, colors.white, LINE)
        c.setFillColor(MUTED)
        c.setFont("GeoGiCJK", 8)
        c.drawString(xx + 14, y + 50, label)
        c.setFillColor(score_color(number(value)))
        c.setFont("GeoGiCJK", 19)
        c.drawString(xx + 14, y + 26, value)
        c.setFillColor(MUTED)
        c.setFont("GeoGiCJK", 8)
        c.drawString(xx + 14, y + 11, desc)


def score_bar(c, x, y, label, score, desc):
    rounded_rect(c, x, y - 42, 480, 52, 10, colors.white, LINE)
    c.setFillColor(DARK)
    c.setFont("GeoGiCJK", 10)
    c.drawString(x + 14, y - 6, label)
    c.setFillColor(score_color(score))
    c.setFont("GeoGiCJK", 13)
    c.drawRightString(x + 456, y - 6, f"{score}/100")
    c.setFillColor(colors.HexColor("#edf3fb"))
    c.rect(x + 14, y - 24, 270, 6, fill=1, stroke=0)
    c.setFillColor(score_color(score))
    c.rect(x + 14, y - 24, 270 * max(0, min(score, 100)) / 100, 6, fill=1, stroke=0)
    c.setFillColor(MUTED)
    c.setFont("GeoGiCJK", 8)
    for i, line in enumerate(wrap_to_width(desc, 410, 8)[:2]):
        c.drawString(x + 14, y - 36 - i * 10, line)


def rounded_rect(c, x, y, w, h, r, fill, stroke):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.roundRect(x, y, w, h, r, fill=1, stroke=1)


def score_overall(data):
    values = [
        score_dimension(data, "品牌识别得分"),
        score_dimension(data, "主动推荐得分"),
        score_dimension(data, "信息准确得分"),
        source_score(data),
    ]
    valid = [v for v in values if v > 0]
    return round(sum(valid) / len(valid)) if valid else 0


def score_dimension(data, field):
    values = []
    for item in data.get("analyses") or []:
        value = item.get(field)
        if isinstance(value, str):
            digits = "".join(ch for ch in value if ch.isdigit())
            if digits:
                values.append(int(digits))
        elif isinstance(value, (int, float)):
            values.append(int(value))
    return round(sum(values) / len(values)) if values else 0


def source_score(data):
    values = [text(item.get("信源可信度")) for item in data.get("analyses") or []]
    if not values:
        return 0
    score = []
    for value in values:
        if "较强" in value:
            score.append(78)
        elif "一般" in value:
            score.append(58)
        elif "待复核" in value or "待补充" in value:
            score.append(38)
        else:
            score.append(50)
    return round(sum(score) / len(score))


def recommendations(data):
    items = []
    for analysis in data.get("analyses") or []:
        value = text(analysis.get("优化建议"))
        if value and value not in items:
            items.append(value)
    brand = text(data.get("form", {}).get("brandName")) or "品牌"
    form = data.get("form", {}) or {}
    product = text(form.get("offerings")) or "核心产品/服务"
    defaults = [
        f"补充{brand}官网品牌介绍、产品说明、客户案例和联系方式，形成稳定可引用的品牌实体。",
        f"围绕{product}的客户真实问题制作结构化问答内容，覆盖推荐、比较、价格、品质、风险和使用场景。",
        "建设第三方可信信源，包括行业媒体、用户评价平台、百科/问答平台和官方渠道交叉验证。",
        "针对豆包、元宝、千问、DeepSeek、Kimi分别复测同一组问题，观察平台差异和竞品压制。",
        "把报告中的高风险问题整理为内容任务，按官网内容、标准问答、第三方信源、平台素材分批推进。",
        "建立月度复测机制，观察品牌识别、主动推荐、竞品压制和信息准确性的变化。"
    ]
    result = []
    for item in items + defaults:
        if item and item not in result:
            result.append(item)
    return result


def contains_brand(item, form):
    brand = text(form.get("brandName"))
    answer = text(item.get("answer"))
    return bool(brand and brand in answer)


def platform_names(data):
    names = []
    for item in data.get("conversations") or []:
        name = canonical_platform(text(item.get("platform")))
        if name and name not in names:
            names.append(name)
    ordered = [name for name in REPORT_PLATFORMS if name in names]
    return " / ".join(ordered or names[:5]) or "待测试"


def platform_coverage_text(data):
    quality = data.get("quality") or {}
    platforms = quality.get("platforms") or []
    covered = sum(1 for item in platforms if int(item.get("final") or 0) > 0)
    return f"{covered}/5"


def quality_line(data):
    quality = data.get("quality") or {}
    platforms = quality.get("platforms") or []
    if not platforms:
        return "本次未获得完整校验信息，需人工复核平台覆盖和问答条数。"
    stats = "，".join(f"{text(item.get('platform'))}{int(item.get('final') or 0)}/{int(item.get('expected') or 6)}" for item in platforms)
    if quality.get("ok"):
        return f"已覆盖 5 个平台，并按检测题对齐为每个平台 6 条问答：{stats}。"
    issues = "；".join(text(item) for item in (quality.get("issues") or [])[:3])
    return f"已完成平台对齐：{stats}。待复核：{issues}。"


def platform_stat(data, platform):
    quality = data.get("quality") or {}
    for item in quality.get("platforms") or []:
        if canonical_platform(text(item.get("platform"))) == platform:
            return item
    return {}


def canonical_platform(value):
    content = text(value)
    lowered = content.lower()
    if "豆包" in content or "doubao" in lowered:
        return "豆包"
    if "元宝" in content or "yuanbao" in lowered or "yb.tencent" in lowered:
        return "元宝"
    if "千问" in content or "qianwen" in lowered or "qwen" in lowered:
        return "千问"
    if "deepseek" in lowered:
        return "DeepSeek"
    if "kimi" in lowered:
        return "Kimi"
    return content


def first_text(items, field):
    for item in items:
        value = text(item.get(field))
        if value:
            return value
    return ""


def score_color(score):
    value = number(score)
    if value >= 75:
        return GREEN
    if value >= 55:
        return ORANGE
    return RED


def score_level(score):
    value = number(score)
    if value >= 75:
        return "表现良好"
    if value >= 55:
        return "可优化"
    return "需系统建设"


def number(value):
    try:
        return int(str(value).split("/")[0])
    except Exception:
        return 0


def limit(value, max_chars):
    value = text(value)
    return value if len(value) <= max_chars else f"{value[:max_chars - 1]}…"


def wrap_to_width(value, width, size, font=FONT_NAME):
    value = text(value)
    lines = []
    for raw in value.split("\n"):
        raw = raw.strip()
        if not raw:
            continue
        current = ""
        for char in raw:
            candidate = f"{current}{char}"
            if current and pdfmetrics.stringWidth(candidate, font, size) > width:
                lines.append(current)
                current = char
            else:
                current = candidate
        if current:
            lines.append(current)
    return lines or [""]


def wrap(value, max_chars):
    value = text(value)
    lines = []
    for raw in value.split("\n"):
        raw = raw.strip()
        while len(raw) > max_chars:
            lines.append(raw[:max_chars])
            raw = raw[max_chars:]
        if raw:
            lines.append(raw)
    return lines or [""]


def date_text(value):
    if not value:
        return datetime.now().strftime("%Y.%m.%d")
    return str(value)[:10].replace("-", ".")


def text(value):
    if value is None:
        return ""
    if isinstance(value, list):
        return "、".join(text(v) for v in value if text(v))
    if isinstance(value, dict):
        return text(value.get("text") or value.get("name") or value.get("value") or value.get("link") or "")
    return str(value).strip()


if __name__ == "__main__":
    main()
