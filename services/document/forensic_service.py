import hashlib
import logging
import re
from typing import Any

from PIL import ExifTags, Image, ImageChops, ImageFilter, ImageOps, ImageStat


logger = logging.getLogger("forensic_service")

PAN_REGEX = re.compile(r"[A-Z]{5}[0-9]{4}[A-Z]")
AADHAAR_REGEX = re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b")

SUSPICIOUS_SOFTWARE = {
    "photoshop",
    "gimp",
    "canva",
    "snapseed",
    "lightroom",
    "illustrator",
    "adobe",
}

VERHOEFF_D = [
    [0,1,2,3,4,5,6,7,8,9],
    [1,2,3,4,0,6,7,8,9,5],
    [2,3,4,0,1,7,8,9,5,6],
    [3,4,0,1,2,8,9,5,6,7],
    [4,0,1,2,3,9,5,6,7,8],
    [5,9,8,7,6,0,4,3,2,1],
    [6,5,9,8,7,1,0,4,3,2],
    [7,6,5,9,8,2,1,0,4,3],
    [8,7,6,5,9,3,2,1,0,4],
    [9,8,7,6,5,4,3,2,1,0],
]
VERHOEFF_P = [
    [0,1,2,3,4,5,6,7,8,9],
    [1,5,7,6,2,8,3,0,9,4],
    [5,8,0,3,7,9,6,1,4,2],
    [8,9,1,6,0,4,3,5,2,7],
    [9,4,5,3,1,2,6,8,7,0],
    [4,2,8,6,5,7,3,9,0,1],
    [2,7,9,3,8,0,6,4,1,5],
    [7,0,4,6,9,1,3,2,5,8],
]


def _safe_ocr(image: Image.Image) -> str:
    try:
        import pytesseract
    except Exception:
        return ""

    variants = []
    base = image.convert("RGB")
    gray = ImageOps.autocontrast(base.convert("L"))
    variants.append(gray)
    variants.append(gray.filter(ImageFilter.SHARPEN))
    variants.append(ImageOps.posterize(base, 3).convert("L"))

    texts = []
    for variant in variants:
        try:
            texts.append(pytesseract.image_to_string(variant))
        except Exception as exc:
            logger.warning("OCR failed for one variant: %s", exc)
    return "\n".join(texts)


def _extract_metadata(image: Image.Image) -> dict[str, Any]:
    exif = {}
    raw_exif = image.getexif() or {}
    for key, value in raw_exif.items():
        tag = ExifTags.TAGS.get(key, str(key))
        exif[tag] = str(value)
    return exif


def _tamper_signals(image: Image.Image, metadata: dict[str, Any], raw_bytes: bytes) -> dict[str, Any]:
    rgb = image.convert("RGB")
    grayscale = ImageOps.grayscale(rgb)
    edges = grayscale.filter(ImageFilter.FIND_EDGES)
    stat = ImageStat.Stat(edges)
    edge_mean = stat.mean[0] if stat.mean else 0
    edge_variance = stat.var[0] if stat.var else 0

    mirrored_diff = ImageChops.difference(grayscale, ImageOps.mirror(grayscale))
    symmetry_score = max(0.0, min(1.0, 1.0 - (ImageStat.Stat(mirrored_diff).mean[0] / 255.0)))

    software = " ".join(
        value for key, value in metadata.items() if key.lower() in {"software", "processingsoftware", "artist"}
    ).lower()
    suspicious_software = any(tool in software for tool in SUSPICIOUS_SOFTWARE)

    entropy_fingerprint = hashlib.sha256(raw_bytes).hexdigest()[:16]

    return {
        "edge_mean": round(edge_mean, 2),
        "edge_variance": round(edge_variance, 2),
        "symmetry_score": round(symmetry_score, 3),
        "suspicious_software": suspicious_software,
        "file_fingerprint": entropy_fingerprint,
    }


def _extract_fields(doc_type: str, ocr_text: str, filename: str) -> dict[str, Any]:
    text = f"{ocr_text}\n{filename}".upper()
    clean = re.sub(r"[^A-Z0-9\s]", " ", text)
    compact_text = re.sub(r"\s+", " ", clean)

    result: dict[str, Any] = {}

    if doc_type == "pan":
        pan_match = PAN_REGEX.search(compact_text)
        if pan_match:
            result["pan_number"] = pan_match.group(0)

        lines = [line.strip() for line in compact_text.splitlines() if line.strip()]
        candidate_names = [
            line for line in lines
            if 6 <= len(line) <= 40
            and "INCOME TAX" not in line
            and "DEPARTMENT" not in line
            and not PAN_REGEX.search(line)
        ]
        if candidate_names:
            result["name"] = candidate_names[0].title()

    if doc_type == "aadhaar":
        aadhaar_match = AADHAAR_REGEX.search(compact_text)
        if aadhaar_match:
            result["aadhaar_number"] = re.sub(r"\s+", "", aadhaar_match.group(0))

        year_match = re.search(r"\b(19|20)\d{2}\b", compact_text)
        if year_match:
            result["birth_year"] = year_match.group(0)

    return result


def _validate(doc_type: str, extracted: dict[str, Any], ocr_text: str) -> tuple[bool, list[str]]:
    issues = []
    upper_text = ocr_text.upper()

    if doc_type == "pan":
        if "INCOME TAX" not in upper_text:
            issues.append("pan_template_missing")
        if not extracted.get("pan_number"):
            issues.append("pan_number_missing")

    if doc_type == "aadhaar":
        if "AADHAAR" not in upper_text and "GOVERNMENT OF INDIA" not in upper_text:
            issues.append("aadhaar_template_missing")
        if not extracted.get("aadhaar_number"):
            issues.append("aadhaar_number_missing")
        elif not _validate_aadhaar_checksum(extracted["aadhaar_number"]):
            issues.append("aadhaar_checksum_failed")

    return len(issues) == 0, issues


def _validate_aadhaar_checksum(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    if len(digits) != 12:
        return False
    checksum = 0
    for idx, item in enumerate(reversed(digits)):
        checksum = VERHOEFF_D[checksum][VERHOEFF_P[idx % 8][int(item)]]
    return checksum == 0


def analyze_document(
    image: Image.Image,
    filename: str,
    content_type: str,
    doc_type: str,
    raw_bytes: bytes,
) -> dict[str, Any]:
    normalized_doc_type = (doc_type or "").strip().lower()
    if normalized_doc_type not in {"pan", "aadhaar"}:
        raise ValueError("doc_type must be 'pan' or 'aadhaar'")

    metadata = _extract_metadata(image)
    ocr_text = _safe_ocr(image)
    extracted = _extract_fields(normalized_doc_type, ocr_text, filename)
    valid, issues = _validate(normalized_doc_type, extracted, ocr_text)
    tamper_signals = _tamper_signals(image, metadata, raw_bytes)

    tamper_score = 0
    if tamper_signals["suspicious_software"]:
        tamper_score += 35
    if tamper_signals["edge_variance"] < 120:
        tamper_score += 15
    if tamper_signals["symmetry_score"] < 0.15:
        tamper_score += 10
    if not valid:
        tamper_score += 20

    confidence = 0.92 if valid else 0.48
    if not ocr_text.strip():
        confidence = min(confidence, 0.3)
        issues.append("ocr_unavailable_or_empty")

    return {
        "doc_type": normalized_doc_type,
        "valid": valid,
        "confidence": round(confidence, 2),
        "tamper_score": min(100, tamper_score),
        "issues": sorted(set(issues)),
        "extracted": extracted,
        "ocr_text_excerpt": ocr_text[:600],
        "metadata": {
            "content_type": content_type,
            "filename": filename,
            "exif_keys": sorted(metadata.keys()),
            "software": metadata.get("Software", ""),
        },
        "forensics": tamper_signals,
    }
