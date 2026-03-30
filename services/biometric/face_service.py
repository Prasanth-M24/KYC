import logging
import os
import warnings
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
warnings.filterwarnings("ignore", message=r".*tf\.losses\.sparse_softmax_cross_entropy.*deprecated.*")
warnings.filterwarnings("ignore", category=UserWarning, module=r"tf_keras\.src\.losses")

logger = logging.getLogger("face_service")

DEEPFACE_MODELS = ("Facenet512", "Facenet")
MODEL_WEIGHT_FILES = {
    "Facenet512": "facenet512_weights.h5",
    "Facenet": "facenet_weights.h5",
}
SFACE_MODEL_DEFAULT = Path(__file__).resolve().parent / "models" / "face_recognition_sface_2021dec.onnx"
YOLO_FACE_MODEL_DEFAULT = Path(__file__).resolve().parent / "models" / "yolo11n_face_detection.onnx"
YOLO_INPUT_SIZE = int(os.getenv("YOLO_FACE_INPUT_SIZE", "640"))
YOLO_SELFIE_CONF_THRESHOLD = float(os.getenv("YOLO_SELFIE_CONF_THRESHOLD", "0.18"))
YOLO_DOC_CONF_THRESHOLD = float(os.getenv("YOLO_DOC_CONF_THRESHOLD", "0.10"))
YOLO_NMS_IOU_THRESHOLD = float(os.getenv("YOLO_NMS_IOU_THRESHOLD", "0.35"))


def _pil_to_cv(image: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)


def _normalize_lighting(img_array: np.ndarray) -> np.ndarray:
    ycrcb = cv2.cvtColor(img_array, cv2.COLOR_BGR2YCrCb)
    channels = list(cv2.split(ycrcb))
    channels[0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(channels[0])
    return cv2.cvtColor(cv2.merge(channels), cv2.COLOR_YCrCb2BGR)


def _is_corrupt_model_error(error: Exception) -> bool:
    message = str(error).lower()
    return "unable to synchronously open file" in message or "file signature not found" in message


def _deepface_cache_dirs() -> list[Path]:
    home = Path.home()
    return [home / ".deepface" / "weights", home / ".keras" / "models"]


def _get_sface_model_path() -> Path | None:
    configured = os.getenv("SFACE_MODEL_PATH", "").strip()
    candidate = Path(configured) if configured else SFACE_MODEL_DEFAULT
    return candidate if candidate.exists() and candidate.is_file() else None


def _get_yolo_face_model_path() -> Path | None:
    configured = os.getenv("YOLO_FACE_MODEL_PATH", "").strip()
    candidate = Path(configured) if configured else YOLO_FACE_MODEL_DEFAULT
    return candidate if candidate.exists() and candidate.is_file() else None


@lru_cache(maxsize=1)
def _load_yolo_face_session():
    model_path = _get_yolo_face_model_path()
    if model_path is None:
        return None
    try:
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.enable_mem_pattern = False
        options.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
        return ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
    except Exception as exc:
        logger.warning("YOLOv11 face model unavailable: %s", exc)
        return None


def warmup_yolo_face_detector() -> dict:
    model_path = _get_yolo_face_model_path()
    session = _load_yolo_face_session()
    return {
        "available": session is not None,
        "model_path": str(model_path) if model_path else None,
        "input_size": YOLO_INPUT_SIZE,
        "error": None if session is not None else "YOLOv11 face detector is unavailable",
    }


@lru_cache(maxsize=1)
def _load_sface_recognizer():
    model_path = _get_sface_model_path()
    if model_path is None:
        return None
    try:
        return cv2.FaceRecognizerSF.create(str(model_path), "")
    except Exception as exc:
        logger.warning("SFace model could not be loaded: %s", exc)
        return None


@lru_cache(maxsize=1)
def _get_haar_cascade():
    return cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def _find_local_weight_file(model_name: str) -> Path | None:
    filename = MODEL_WEIGHT_FILES.get(model_name)
    if not filename:
        return None
    for cache_dir in _deepface_cache_dirs():
        candidate = cache_dir / filename
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _has_any_local_deepface_weights() -> bool:
    return any(_find_local_weight_file(model_name) for model_name in DEEPFACE_MODELS)


def _repair_deepface_cache() -> list[str]:
    removed = []
    for cache_dir in _deepface_cache_dirs():
        if not cache_dir.exists():
            continue
        for pattern in ("*facenet*", "*vgg*", "*.h5", "*.weights.h5"):
            for candidate in cache_dir.glob(pattern):
                if candidate.is_file():
                    try:
                        candidate.unlink()
                        removed.append(str(candidate))
                    except OSError as exc:
                        logger.warning("Could not remove cached model file %s: %s", candidate, exc)
    return removed


def warmup_deepface() -> dict:
    if not _has_any_local_deepface_weights():
        return {
            "available": False,
            "library": "deepface",
            "error": "DeepFace weights are not installed locally; startup warmup skipped",
            "models": [],
            "skipped": True,
        }
    try:
        from deepface import DeepFace

        loaded = []
        for model_name in DEEPFACE_MODELS:
            if not _find_local_weight_file(model_name):
                continue
            try:
                DeepFace.build_model(model_name)
                loaded.append(model_name)
            except Exception as exc:
                if _is_corrupt_model_error(exc):
                    _repair_deepface_cache()
                else:
                    logger.warning("DeepFace warmup failed for %s: %s", model_name, exc)
        return {
            "available": len(loaded) > 0,
            "library": DeepFace.__name__,
            "models": loaded,
            "error": None if loaded else "Local DeepFace weights could not be loaded",
        }
    except Exception as exc:
        return {"available": False, "error": str(exc)}


def warmup_biometric_models() -> dict:
    yolo_status = warmup_yolo_face_detector()
    sface_path = _get_sface_model_path()
    sface_ready = _load_sface_recognizer() is not None
    deepface_status = warmup_deepface()
    preferred_provider = (
        "yolov11_sface"
        if yolo_status.get("available") and sface_ready
        else "yolov11_deepface"
        if yolo_status.get("available") and deepface_status.get("available")
        else "opencv_sface"
        if sface_ready
        else "deepface"
        if deepface_status.get("available")
        else "orb_histogram_ensemble"
    )
    return {
        "preferred_provider": preferred_provider,
        "yolo_face": yolo_status,
        "sface_ready": sface_ready,
        "sface_model_path": str(sface_path) if sface_path else None,
        "deepface": deepface_status,
    }


def _letterbox_image(cv_img: np.ndarray) -> tuple[np.ndarray, float, int, int]:
    height, width = cv_img.shape[:2]
    scale = min(YOLO_INPUT_SIZE / max(width, 1), YOLO_INPUT_SIZE / max(height, 1))
    resized_width = max(1, int(round(width * scale)))
    resized_height = max(1, int(round(height * scale)))
    resized = cv2.resize(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB), (resized_width, resized_height))
    canvas = np.full((YOLO_INPUT_SIZE, YOLO_INPUT_SIZE, 3), 114, dtype=np.uint8)
    pad_x = (YOLO_INPUT_SIZE - resized_width) // 2
    pad_y = (YOLO_INPUT_SIZE - resized_height) // 2
    canvas[pad_y:pad_y + resized_height, pad_x:pad_x + resized_width] = resized
    tensor = np.transpose(canvas.astype(np.float32) / 255.0, (2, 0, 1))[None]
    return tensor, scale, pad_x, pad_y


def _extract_yolo_rows(raw_output: np.ndarray) -> np.ndarray:
    predictions = np.squeeze(raw_output)
    if predictions.ndim != 2:
        return np.empty((0, 5), dtype=np.float32)
    if predictions.shape[0] < predictions.shape[1]:
        predictions = predictions.T
    return predictions.astype(np.float32, copy=False)


def _run_yolo_face_detector(cv_img: np.ndarray, conf_threshold: float) -> list[dict]:
    session = _load_yolo_face_session()
    if session is None:
        return []

    tensor, scale, pad_x, pad_y = _letterbox_image(cv_img)
    raw_output = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    predictions = _extract_yolo_rows(raw_output)
    if predictions.size == 0:
        return []

    scores = predictions[:, 4] if predictions.shape[1] <= 5 else predictions[:, 4] * np.max(predictions[:, 5:], axis=1)
    keep_mask = scores >= conf_threshold
    if not np.any(keep_mask):
        return []

    image_height, image_width = cv_img.shape[:2]
    boxes = []
    candidates = []
    for row, score in zip(predictions[keep_mask], scores[keep_mask], strict=False):
        cx, cy, width, height = [float(value) for value in row[:4]]
        x1 = ((cx - (width / 2.0)) - pad_x) / max(scale, 1e-6)
        y1 = ((cy - (height / 2.0)) - pad_y) / max(scale, 1e-6)
        x2 = ((cx + (width / 2.0)) - pad_x) / max(scale, 1e-6)
        y2 = ((cy + (height / 2.0)) - pad_y) / max(scale, 1e-6)
        box = [
            max(0, int(round(x1))),
            max(0, int(round(y1))),
            max(1, int(round(min(x2, image_width) - max(0.0, x1)))),
            max(1, int(round(min(y2, image_height) - max(0.0, y1)))),
        ]
        if box[2] < 12 or box[3] < 12:
            continue
        boxes.append(box)
        candidates.append({"box": box, "confidence": float(score)})

    if not boxes:
        return []

    indices = cv2.dnn.NMSBoxes(boxes, [item["confidence"] for item in candidates], conf_threshold, YOLO_NMS_IOU_THRESHOLD)
    if len(indices) == 0:
        return []

    selected = []
    for raw_index in indices:
        index = int(raw_index[0] if isinstance(raw_index, (list, tuple, np.ndarray)) else raw_index)
        selected.append(candidates[index])
    return selected


def _candidate_regions(cv_img: np.ndarray, document_mode: bool) -> list[dict]:
    height, width = cv_img.shape[:2]
    regions = [{"name": "full", "image": cv_img, "offset_x": 0, "offset_y": 0}]
    if not document_mode or width < 220 or height < 140:
        return regions

    left_width = max(120, int(round(width * 0.62)))
    right_x = max(0, width - left_width)
    upper_height = max(100, int(round(height * 0.78)))
    regions.extend(
        [
            {"name": "left", "image": cv_img[:, :left_width], "offset_x": 0, "offset_y": 0},
            {"name": "right", "image": cv_img[:, right_x:], "offset_x": right_x, "offset_y": 0},
            {"name": "upper_left", "image": cv_img[:upper_height, :left_width], "offset_x": 0, "offset_y": 0},
            {"name": "upper_right", "image": cv_img[:upper_height, right_x:], "offset_x": right_x, "offset_y": 0},
        ]
    )
    return regions


def _compute_box_iou(box_a: list[int], box_b: list[int]) -> float:
    ax, ay, aw, ah = box_a
    bx, by, bw, bh = box_b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    inter_x1 = max(ax, bx)
    inter_y1 = max(ay, by)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_w = max(0, inter_x2 - inter_x1)
    inter_h = max(0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h
    if inter_area == 0:
        return 0.0
    union = (aw * ah) + (bw * bh) - inter_area
    return inter_area / max(union, 1)


def _expand_box(box: list[int], image_width: int, image_height: int, padding_ratio: float = 0.16) -> list[int]:
    x, y, width, height = box
    pad_x = int(round(width * padding_ratio))
    pad_y = int(round(height * padding_ratio))
    new_x = max(0, x - pad_x)
    new_y = max(0, y - pad_y)
    new_x2 = min(image_width, x + width + pad_x)
    new_y2 = min(image_height, y + height + pad_y)
    return [new_x, new_y, max(1, new_x2 - new_x), max(1, new_y2 - new_y)]


def _face_quality_metrics(face_crop: np.ndarray, confidence: float, area_ratio: float) -> dict:
    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(np.mean(gray) / 255.0)
    contrast = float(np.std(gray) / 64.0)
    quality = (
        confidence * 0.45
        + min(1.0, area_ratio * 8.0) * 0.2
        + min(1.0, sharpness / 120.0) * 0.2
        + (1.0 - min(1.0, abs(brightness - 0.55) / 0.55)) * 0.1
        + min(1.0, contrast) * 0.05
    )
    return {
        "sharpness": float(f"{sharpness:.2f}"),
        "brightness": float(f"{brightness:.3f}"),
        "area_ratio": float(f"{area_ratio:.4f}"),
        "quality_score": float(f"{min(1.0, quality):.3f}"),
    }


def _candidate_from_detection(cv_img: np.ndarray, box: list[int], confidence: float, region: str, source_name: str) -> dict | None:
    image_height, image_width = cv_img.shape[:2]
    expanded_box = _expand_box(box, image_width, image_height)
    x, y, width, height = expanded_box
    cropped = cv_img[y:y + height, x:x + width]
    if cropped.size == 0:
        return None
    cropped = _normalize_lighting(cropped)
    metrics = _face_quality_metrics(cropped, confidence, (width * height) / max(float(image_width * image_height), 1.0))
    return {
        "x": x,
        "y": y,
        "w": width,
        "h": height,
        "area": width * height,
        "confidence": float(f"{confidence:.4f}"),
        "region": region,
        "source_name": source_name,
        "cropped_face": cropped,
        **metrics,
    }


def _deduplicate_candidates(candidates: list[dict]) -> list[dict]:
    ordered = sorted(candidates, key=lambda item: (item["quality_score"], item["confidence"], item["area"]), reverse=True)
    selected = []
    for candidate in ordered:
        if any(_compute_box_iou([candidate["x"], candidate["y"], candidate["w"], candidate["h"]], [kept["x"], kept["y"], kept["w"], kept["h"]]) > 0.5 for kept in selected):
            continue
        selected.append(candidate)
    return selected


def _detect_faces_with_yolo(cv_img: np.ndarray, document_mode: bool, source_name: str) -> dict:
    confidence_threshold = YOLO_DOC_CONF_THRESHOLD if document_mode else YOLO_SELFIE_CONF_THRESHOLD
    candidates = []
    for region in _candidate_regions(cv_img, document_mode):
        for detection in _run_yolo_face_detector(region["image"], confidence_threshold):
            local_x, local_y, width, height = detection["box"]
            candidate = _candidate_from_detection(
                cv_img,
                [local_x + region["offset_x"], local_y + region["offset_y"], width, height],
                detection["confidence"],
                region["name"],
                source_name,
            )
            if candidate is not None:
                candidates.append(candidate)

    candidates = _deduplicate_candidates(candidates)
    if not candidates:
        return {"detected": False, "count": 0, "faces": [], "largest_area": 0, "cropped_face": None, "detector": "yolov11_face_onnx"}

    best_face = max(candidates, key=lambda item: (item["quality_score"], item["confidence"], item["area"]))
    return {
        "detected": True,
        "count": len(candidates),
        "faces": [{"x": item["x"], "y": item["y"], "w": item["w"], "h": item["h"], "area": item["area"], "confidence": item["confidence"], "quality_score": item["quality_score"], "region": item["region"]} for item in candidates],
        "largest_area": best_face["area"],
        "cropped_face": best_face["cropped_face"],
        "detector": "yolov11_face_onnx",
        "source_name": source_name,
        "detection_confidence": best_face["confidence"],
        "face_quality": best_face["quality_score"],
        "selection_score": float(f"{((best_face['quality_score'] * 0.7) + (best_face['confidence'] * 0.3)):.3f}"),
    }


def _haar_detect_face(cv_img: np.ndarray, source_name: str) -> dict:
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    detections = _get_haar_cascade().detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    if len(detections) == 0:
        return {"detected": False, "count": 0, "faces": [], "largest_area": 0, "cropped_face": None, "detector": "haar"}

    candidates = []
    for x, y, width, height in detections:
        candidate = _candidate_from_detection(cv_img, [int(x), int(y), int(width), int(height)], 0.45, "haar", source_name)
        if candidate is not None:
            candidates.append(candidate)
    if not candidates:
        return {"detected": False, "count": 0, "faces": [], "largest_area": 0, "cropped_face": None, "detector": "haar"}

    best_face = max(candidates, key=lambda item: (item["quality_score"], item["area"]))
    return {
        "detected": True,
        "count": len(candidates),
        "faces": [{"x": item["x"], "y": item["y"], "w": item["w"], "h": item["h"], "area": item["area"], "confidence": item["confidence"], "quality_score": item["quality_score"], "region": item["region"]} for item in candidates],
        "largest_area": best_face["area"],
        "cropped_face": best_face["cropped_face"],
        "detector": "haar",
        "source_name": source_name,
        "detection_confidence": best_face["confidence"],
        "face_quality": best_face["quality_score"],
        "selection_score": best_face["quality_score"],
    }


def detect_face(image: Image.Image, *, document_mode: bool = False, source_name: str = "image") -> dict:
    cv_img = _pil_to_cv(image)
    yolo_result = _detect_faces_with_yolo(cv_img, document_mode=document_mode, source_name=source_name)
    if yolo_result.get("detected"):
        return yolo_result
    return _haar_detect_face(cv_img, source_name=source_name)


def detect_liveness(image: Image.Image) -> dict:
    cv_img = _pil_to_cv(image)
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    signals = {}
    face_info = detect_face(image, source_name="selfie")
    signals["face_detected"] = face_info["detected"]
    signals["face_count"] = face_info.get("count", 0)
    signals["detector"] = face_info.get("detector")
    if not face_info["detected"]:
        return {"liveness_score": 0.0, "signals": signals, "reason": "no_face_detected"}
    if face_info.get("count", 0) != 1:
        return {"liveness_score": 0.2, "signals": signals, "reason": "multiple_or_zero_faces"}

    cropped = face_info["cropped_face"]
    eval_img = cropped if cropped is not None and cropped.size > 0 else cv_img
    eval_gray = cv2.cvtColor(eval_img, cv2.COLOR_BGR2GRAY) if eval_img is not cv_img else gray

    lap_var = float(cv2.Laplacian(eval_gray, cv2.CV_64F).var())
    signals["sharpness"] = float(f"{lap_var:.2f}")
    sharpness_score = min(1.0, lap_var / 200.0)

    _, bright_mask = cv2.threshold(eval_gray, 200, 255, cv2.THRESH_BINARY)
    specular_ratio = float(np.sum(bright_mask > 0)) / (eval_gray.shape[0] * eval_gray.shape[1] + 1e-6)
    signals["specular_ratio"] = float(f"{specular_ratio:.4f}")

    brightness = float(np.mean(eval_gray)) / 255.0
    signals["brightness"] = float(f"{brightness:.3f}")

    ycrcb = cv2.cvtColor(eval_img, cv2.COLOR_BGR2YCrCb)
    skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77], dtype=np.uint8), np.array([255, 180, 135], dtype=np.uint8))
    skin_ratio = float(np.sum(skin_mask > 0)) / (skin_mask.shape[0] * skin_mask.shape[1] + 1e-6)
    signals["skin_ratio"] = float(f"{skin_ratio:.4f}")

    score = (min(1.0, skin_ratio * 3.0) * 0.5) + (sharpness_score * 0.3) + ((1.0 - min(1.0, abs(brightness - 0.55) / 0.55)) * 0.2)
    return {"liveness_score": float(f"{score:.3f}"), "signals": signals}


def _offline_face_similarity(selfie_face: np.ndarray, doc_face: np.ndarray) -> dict:
    selfie_gray = cv2.cvtColor(cv2.resize(selfie_face, (192, 192)), cv2.COLOR_BGR2GRAY)
    doc_gray = cv2.cvtColor(cv2.resize(doc_face, (192, 192)), cv2.COLOR_BGR2GRAY)

    orb = cv2.ORB_create(nfeatures=768)
    kp1, des1 = orb.detectAndCompute(selfie_gray, None)
    kp2, des2 = orb.detectAndCompute(doc_gray, None)
    orb_score = 0.0
    if des1 is not None and des2 is not None and len(kp1) > 0 and len(kp2) > 0:
        matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = sorted(matcher.match(des1, des2), key=lambda item: item.distance)
        good = [item for item in matches if item.distance < 48]
        orb_score = min(1.0, len(good) / max(min(len(kp1), len(kp2)), 1))

    selfie_hist = cv2.normalize(cv2.calcHist([selfie_gray], [0], None, [256], [0, 256]), None).flatten()
    doc_hist = cv2.normalize(cv2.calcHist([doc_gray], [0], None, [256], [0, 256]), None).flatten()
    hist_corr = cv2.compareHist(selfie_hist, doc_hist, cv2.HISTCMP_CORREL)
    hist_score = max(0.0, min(1.0, (hist_corr + 1.0) / 2.0))

    edge1 = cv2.Canny(selfie_gray, 80, 160)
    edge2 = cv2.Canny(doc_gray, 80, 160)
    edge_score = 1.0 - min(1.0, np.mean(cv2.absdiff(edge1, edge2)) / 255.0)

    score = (orb_score * 0.6) + (hist_score * 0.2) + (edge_score * 0.2)
    return {
        "face_match_score": float(f"{score:.3f}"),
        "verified": score >= 0.7,
        "method": "orb_histogram_ensemble",
        "orb_score": float(f"{orb_score:.3f}"),
        "histogram_score": float(f"{hist_score:.3f}"),
        "edge_score": float(f"{edge_score:.3f}"),
    }


def _sface_similarity(selfie_face: np.ndarray, doc_face: np.ndarray) -> dict | None:
    recognizer = _load_sface_recognizer()
    if recognizer is None:
        return None
    try:
        selfie_rgb = cv2.cvtColor(cv2.resize(selfie_face, (112, 112)), cv2.COLOR_BGR2RGB)
        doc_rgb = cv2.cvtColor(cv2.resize(doc_face, (112, 112)), cv2.COLOR_BGR2RGB)
        feat1 = recognizer.feature(selfie_rgb)
        feat2 = recognizer.feature(doc_rgb)
        cosine = float(recognizer.match(feat1, feat2, cv2.FaceRecognizerSF_FR_COSINE))
        score = max(0.0, min(1.0, (cosine + 1.0) / 2.0))
        return {
            "face_match_score": float(f"{score:.3f}"),
            "verified": score >= 0.72,
            "method": "opencv_sface",
            "cosine_similarity": float(f"{cosine:.4f}"),
        }
    except Exception as exc:
        logger.warning("SFace verification failed: %s", exc)
        return None


def _deepface_similarity(selfie_face: np.ndarray, doc_face: np.ndarray) -> dict | None:
    if not _has_any_local_deepface_weights():
        return None

    try:
        from deepface import DeepFace
    except Exception as exc:
        logger.warning("DeepFace import unavailable: %s", exc)
        return None

    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as selfie_file, tempfile.NamedTemporaryFile(
        suffix=".jpg", delete=False
    ) as doc_file:
        cv2.imwrite(selfie_file.name, selfie_face)
        cv2.imwrite(doc_file.name, doc_face)
        selfie_path = selfie_file.name
        doc_path = doc_file.name

    try:
        last_error = None
        for model_name in DEEPFACE_MODELS:
            if not _find_local_weight_file(model_name):
                continue
            try:
                result = DeepFace.verify(
                    img1_path=selfie_path,
                    img2_path=doc_path,
                    model_name=model_name,
                    enforce_detection=False,
                    detector_backend="opencv",
                    align=True,
                )
                distance = float(result.get("distance", 1.0))
                threshold = float(result.get("threshold", 0.4))
                score = max(0.0, min(1.0, 1.0 - (distance / max(threshold * 2, 0.001))))
                return {
                    "face_match_score": float(f"{score:.3f}"),
                    "verified": bool(result.get("verified", False)),
                    "distance": float(f"{distance:.4f}"),
                    "threshold": threshold,
                    "method": f"deepface_{model_name.lower()}",
                }
            except Exception as exc:
                last_error = exc
                logger.warning("DeepFace model %s failed: %s", model_name, exc)
                if _is_corrupt_model_error(exc):
                    _repair_deepface_cache()
        if last_error:
            logger.warning("DeepFace verification unavailable after SFace attempt: %s", last_error)
        return None
    finally:
        os.unlink(selfie_path)
        os.unlink(doc_path)


def _compare_face_crops(selfie_face: np.ndarray, doc_face: np.ndarray) -> dict:
    sface_result = _sface_similarity(selfie_face, doc_face)
    if sface_result is not None:
        return sface_result
    deepface_result = _deepface_similarity(selfie_face, doc_face)
    if deepface_result is not None:
        return deepface_result
    return _offline_face_similarity(selfie_face, doc_face)


def _coerce_document_inputs(document_images) -> list[dict]:
    if isinstance(document_images, Image.Image):
        return [{"label": "document", "image": document_images}]

    normalized = []
    for item in document_images or []:
        if isinstance(item, dict):
            label = str(item.get("label") or "document")
            image = item.get("image")
        elif isinstance(item, (tuple, list)) and len(item) >= 2:
            label = str(item[0] or "document")
            image = item[1]
        else:
            continue

        if isinstance(image, Image.Image):
            normalized.append({"label": label, "image": image})
    return normalized


def match_faces(selfie: Image.Image, document_images) -> dict:
    documents = _coerce_document_inputs(document_images)
    if not documents:
        return {
            "face_match_score": 0.0,
            "verified": False,
            "error": "No document image was provided for biometric comparison.",
            "method": "failed",
        }

    selfie_info = detect_face(selfie, source_name="selfie")
    if not selfie_info["detected"] or selfie_info.get("cropped_face") is None:
        return {
            "face_match_score": 0.0,
            "verified": False,
            "error": "Face not detected in the selfie image.",
            "method": "failed",
        }

    selfie_face = selfie_info["cropped_face"]
    candidate_results = []
    for document in documents:
        doc_info = detect_face(document["image"], document_mode=True, source_name=document["label"])
        if not doc_info["detected"] or doc_info.get("cropped_face") is None:
            candidate_results.append(
                {
                    "label": document["label"],
                    "detected": False,
                    "detector": doc_info.get("detector"),
                    "face_quality": 0.0,
                    "selection_score": 0.0,
                    "match_score": 0.0,
                    "verified": False,
                }
            )
            continue

        comparison = _compare_face_crops(selfie_face, doc_info["cropped_face"])
        ranking_score = (comparison.get("face_match_score", 0.0) * 0.8) + (doc_info.get("selection_score", 0.0) * 0.2)
        candidate_results.append(
            {
                "label": document["label"],
                "detected": True,
                "detector": doc_info.get("detector"),
                "face_quality": doc_info.get("face_quality", 0.0),
                "selection_score": doc_info.get("selection_score", 0.0),
                "match_score": comparison.get("face_match_score", 0.0),
                "verified": comparison.get("verified", False),
                "detection_confidence": doc_info.get("detection_confidence"),
                "comparison": comparison,
                "ranking_score": float(f"{ranking_score:.3f}"),
            }
        )

    valid_candidates = [item for item in candidate_results if item.get("detected") and item.get("comparison")]
    if not valid_candidates:
        return {
            "face_match_score": 0.0,
            "verified": False,
            "error": "Face not detected in PAN or Aadhaar image.",
            "method": "failed",
            "document_candidates": candidate_results,
        }

    best_candidate = max(valid_candidates, key=lambda item: (item["ranking_score"], item["match_score"], item["face_quality"]))
    comparison = dict(best_candidate["comparison"])
    comparison["method"] = f"yolov11_{comparison['method']}"
    comparison["document_source"] = best_candidate["label"]
    comparison["detector_provider"] = "yolov11_face_onnx"
    comparison["document_candidates"] = [
        {
            "label": item["label"],
            "detected": item["detected"],
            "detector": item["detector"],
            "match_score": item.get("match_score", 0.0),
            "verified": item.get("verified", False),
            "face_quality": item.get("face_quality", 0.0),
            "selection_score": item.get("selection_score", 0.0),
            "detection_confidence": item.get("detection_confidence"),
        }
        for item in candidate_results
    ]
    return comparison
