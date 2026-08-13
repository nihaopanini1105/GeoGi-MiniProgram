#!/usr/bin/env python3
import argparse
import hashlib
import importlib.util
import io
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops
from pypdf import PdfReader


SERVER_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SERVER_ROOT.parent
RENDERER = SERVER_ROOT / "src" / "scripts" / "render-report-pdf.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
CANONICAL_LOGOS = PROJECT_ROOT / "assets" / "brand" / "logo-system" / "v1.0" / "png"
WHITE_LOGO = CANONICAL_LOGOS / "geogi-logo-horizontal-white-1024.png"
NAVY_LOGO = CANONICAL_LOGOS / "geogi-logo-horizontal-navy-1024.png"
DEFAULT_OUTPUT = PROJECT_ROOT / "output" / "pdf" / "report-regression"
FORBIDDEN_LINE_START = set("，。！？；：、）》】”’")


def load_renderer():
    spec = importlib.util.spec_from_file_location("render_report_pdf", RENDERER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def render(fixture, output):
    subprocess.run(
        [sys.executable, str(RENDERER), str(fixture), str(output)],
        check=True,
        timeout=30,
    )


def extract_pages(pdf_path):
    reader = PdfReader(str(pdf_path))
    return reader, [(page.extract_text() or "") for page in reader.pages]


def normalized_text(value):
    return "".join(value.split())


def assert_contains(text, values, case_name):
    normalized = normalized_text(text)
    missing = [value for value in values if normalized_text(value) not in normalized]
    if missing:
        raise AssertionError(f"{case_name} missing text: {missing}")


def assert_absent(text, values, case_name):
    normalized = normalized_text(text)
    present = [value for value in values if normalized_text(value) in normalized]
    if present:
        raise AssertionError(f"{case_name} contains prohibited text: {present}")


def image_digest(image):
    normalized = image.convert("RGBA")
    return hashlib.sha256(normalized.tobytes()).hexdigest(), normalized.size


def assert_logo_pixels(reader, expected_path, page_index, case_name):
    page_images = list(reader.pages[page_index].images)
    if len(page_images) != 1:
        raise AssertionError(
            f"{case_name} page {page_index + 1} expected exactly one canonical logo image, found {len(page_images)}"
        )
    embedded = Image.open(io.BytesIO(page_images[0].data))
    expected = Image.open(expected_path)
    embedded_digest, embedded_size = image_digest(embedded)
    expected_digest, expected_size = image_digest(expected)
    if embedded_size != expected_size or embedded_digest != expected_digest:
        embedded_rgba = embedded.convert("RGBA")
        expected_rgba = expected.convert("RGBA")
        if embedded_rgba.size != expected_rgba.size or ImageChops.difference(embedded_rgba, expected_rgba).getbbox():
            raise AssertionError(
                f"{case_name} page {page_index + 1} logo does not match {expected_path.name}"
            )


def assert_logos(reader, case_name):
    if len(reader.pages) != 6:
        raise AssertionError(f"{case_name} expected 6 pages, found {len(reader.pages)}")
    assert_logo_pixels(reader, WHITE_LOGO, 0, case_name)
    for page_index in range(1, len(reader.pages)):
        assert_logo_pixels(reader, NAVY_LOGO, page_index, case_name)


def assert_wrap_regression(renderer):
    renderer.register_font()
    samples = [
        "中文标点换行测试，下一句继续。",
        "括号中的说明（需要完整保留）》下一段。",
        "引用内容“需要正确换行”；结论明确！",
    ]
    for sample in samples:
        for width in range(24, 121, 3):
            lines = renderer.wrap_to_width(sample, width, 10)
            bad = [line for line in lines[1:] if line and line[0] in FORBIDDEN_LINE_START]
            if bad:
                raise AssertionError(f"forbidden CJK punctuation at line start: {bad}")


def assert_logo_fail_fast(renderer):
    missing_logo = CANONICAL_LOGOS / "missing-canonical-logo.png"
    try:
        renderer.draw_logo(None, 0, 0, 1, 1, str(missing_logo))
    except FileNotFoundError as error:
        if "GeoGi canonical logo not found" not in str(error):
            raise AssertionError("canonical logo failure must identify the missing GeoGi asset") from error
    else:
        raise AssertionError("missing canonical logo must fail fast")


def verify_case_a(reader, pages):
    text = "\n".join(pages)
    assert_contains(text, [
        "综合得分",
        "待分析",
        "状态",
        "暂无分析结果",
        "渲染测试版",
        "回归测试品牌的 AI 可见度尚待完成分析",
        "当前文件仅用于验证 GeoGi 报告渲染、中文字体、品牌视觉与 PDF 输出链路。",
        "尚未导入真实 AI 平台问答和分析结果，因此不形成客户诊断结论。",
        "尚未获得真实平台分析数据。本页不对品牌 AI 可见度、推荐表现或优化优先级作出判断。",
        "测试问答",
        "待检测",
        "尚未导入问答",
        "平台覆盖",
        "尚未开始检测",
        "品牌识别度",
        "主动推荐度",
        "信息准确度",
        "信源可信度",
        "完成平台检测与分析后生成优化建议",
        "尚未导入真实 AI 平台问答与分析结果，因此本页不生成品牌优化建议。",
        "当前为报告渲染测试文件，仅用于验证 PDF 生成、中文字体、品牌视觉和页面布局，不作为客户诊断结果或优化方案。",
        "尚未导入真实平台问答数据；当前仅完成报告渲染链路验证；不形成诊断结论。",
    ], "CASE A")
    assert_absent(text, [
        "0 / 100",
        "0/100",
        "需系统建设",
        "已有一定 AI 可见度基础",
        "当前 AI 可见度基础较弱",
        "表现良好",
        "可优化",
        "补充回归测试品牌官网品牌介绍",
        "GeoGi 几何智引",
        "Generate to be Found.",
    ], "CASE A")
    if text.count("待分析") < 6:
        raise AssertionError("CASE A must show no-data semantics for summary and all four GEO metrics")
    assert_logos(reader, "CASE A")


def verify_case_b(reader, pages):
    text = "\n".join(pages)
    assert_contains(text, [
        "80",
        "/ 100",
        "80/100",
        "表现良好",
        "正式快检版",
        "回归测试品牌的 AI 可见度已形成可诊断样本",
        "回归测试品牌已有一定 AI 可见度基础",
        "品牌已被识别，但主动推荐理由仍需补充证据。",
        "回归测试品牌应优先补强可被 AI 引用的品牌证据",
        "补充可被 AI 引用的客户案例与第三方行业信源。",
    ], "CASE B")
    assert_absent(text, [
        "渲染测试版",
        "尚待完成分析",
        "暂无分析结果",
        "完成平台检测与分析后生成优化建议",
        "GeoGi 几何智引",
        "Generate to be Found.",
    ], "CASE B")
    assert_logos(reader, "CASE B")


def main():
    parser = argparse.ArgumentParser(description="Generate and verify PDF report regression fixtures.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    renderer = load_renderer()
    assert_wrap_regression(renderer)
    assert_logo_fail_fast(renderer)

    outputs = {
        "CASE A": args.output_dir / "geogi-report-case-a-no-data.pdf",
        "CASE B": args.output_dir / "geogi-report-case-b-with-analysis.pdf",
    }
    fixtures = {
        "CASE A": FIXTURES / "report-case-a-no-data.json",
        "CASE B": FIXTURES / "report-case-b-with-analysis.json",
    }

    for case_name in ("CASE A", "CASE B"):
        render(fixtures[case_name], outputs[case_name])
        reader, pages = extract_pages(outputs[case_name])
        if case_name == "CASE A":
            verify_case_a(reader, pages)
        else:
            verify_case_b(reader, pages)
        print(f"{case_name} PASS: {outputs[case_name]}")

    print("CJK punctuation wrap PASS")
    print("Canonical logo fail-fast PASS")
    print("Canonical logo pixel checks PASS")


if __name__ == "__main__":
    main()
