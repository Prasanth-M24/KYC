import logging
import os
import tempfile
import warnings
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
warnings.filterwarnings(
    "ignore",
    message=r".*tf\.losses\.sparse_softmax_cross_entropy.*deprecated.*",
)
warnings.filterwarnings(
    "ignore",
    category=UserWarning,
    module=r"tf_keras\.src\.losses",
)

logger = logging.getLogger("face_service")
DEEPFACE_MODELS = ("Facenet512", "Facenet")
MODEL_WEIGHT_FILES = {
    "Facenet512": "facenet512_weights.h5",
    "Facenet": "facenet_weights.h5",
}
SFACE_MODEL_DEFAULT = Path(__file__).resolve().parent / "models" / "face_recognition_sface_2021dec.onnx"


def _pil_to_cv(image: Image.Image) -> np.ndarray:
    return cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)


def _normalize_lighting(img_array: np.ndarray) -> np.ndarray:
    ycrcb = cv2.cvtColor(img_array, cv2.COLOR_BGR2YCrCb)
    channels = list(cv2.split(ycrcb))
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    channels[0] = clahe.apply(channels[0])
    ycrcb = cv2.merge(channels)
    return cv2.cvtColor(ycrcb, cv2.COLOR_YCrCb2BGR)


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


@lru_cache(maxsize=1)
def _load_sface_recognizer():
    model_path = _get_sface_model_path()
    if model_path is None:
        return None
    try:
        return cv2.FaceRecognizerSF.create(str(model_path), "")
    except Exception as exc:
        logger.warning("SFace model could not be loaded from %s: %s", model_path, exc)
        return None


@lru_cache(maxsize=1)
def _get_haar_cascade():
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    return cv2.CascadeClassifier(cascade_path)


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
    patterns = ("*facenet*", "*vgg*", "*.h5", "*.weights.h5")
    for cache_dir in _deepface_cache_dirs():
        if not cache_dir.exists():
            continue
        for pattern in patterns:
            for candidate in cache_dir.glob(pattern):
                if candidate.is_file():
                    try:
                        candidate.unlink()
                        removed.append(str(candidate))
                    except OSError as exc:
                        logger.warning("Could not remove cached model file %s: %s", candidate, exc)
    return removed


def _verify_with_deepface(selfie_path: str, doc_path: str) -> dict:
    from deepface import DeepFace

    if not _has_any_local_deepface_weights():
        raise RuntimeError("DeepFace weights are not available locally")

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
            result["resolved_model_name"] = model_name
            return result
        except Exception as exc:
            last_error = exc
            logger.warning("DeepFace model %s failed: %s", model_name, exc)

    raise last_error if last_error else RuntimeError("DeepFace verification failed without a captured error")


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
                    removed = _repair_deepface_cache()
                    logger.warning("Corrupt DeepFace cache detected during warmup. Removed files: %s", removed)
                    DeepFace.build_model(model_name)
                    loaded.append(model_name)
                else:
                    logger.warning("DeepFace warmup failed for %s: %s", model_name, exc)
        return {
            "available": len(loaded) > 0,
            "library": DeepFace.__name__,
            "models": loaded,
            "error": None if loaded else "Local DeepFace weights could not be loaded",
        }
    except Exception as exc:
        if _is_corrupt_model_error(exc):
            removed = _repair_deepface_cache()
            logger.warning("Corrupt DeepFace cache detected during warmup. Removed files: %s", removed)
        return {"available": False, "error": str(exc)}


def warmup_biometric_models() -> dict:
    sface_path = _get_sface_model_path()
    sface_ready = _load_sface_recognizer() is not None
    deepface_status = warmup_deepface()
    preferred_provider = "opencv_sface" if sface_ready else "deepface" if deepface_status.get("available") else "orb_histogram_ensemble"
    return {
        "preferred_provider": preferred_provider,
        "sface_ready": sface_ready,
        "sface_model_path": str(sface_path) if sface_path else None,
        "deepface": deepface_status,
    }


def _haar_detect_face(cv_img: np.ndarray) -> dict:
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    cascade = _get_haar_cascade()
    detections = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    if len(detections) == 0:
        return {"detected": False, "count": 0, "faces": [], "largest_area": 0, "cropped_face": None}

    face_list = []
    for (x, y, w, h) in detections:
        face_list.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h), "area": int(w * h)})

    largest_face = max(face_list, key=lambda item: item["area"])
    x, y, w, h = largest_face["x"], largest_face["y"], largest_face["w"], largest_face["h"]
    cropped = cv_img[max(0, y):y + h, max(0, x):x + w]
    if cropped.size > 0:
        cropped = _normalize_lighting(cropped)

    return {
        "detected": True,
        "count": len(face_list),
        "faces": face_list,
        "largest_area": largest_face["area"],
        "cropped_face": cropped,
    }


def detect_face(image: Image.Image) -> dict:
    cv_img = _pil_to_cv(image)
    if not _has_any_local_deepface_weights():
        return _haar_detect_face(cv_img)

    try:
        from deepface import DeepFace

        faces = DeepFace.extract_faces(
            img_path=cv_img,
            detector_backend="opencv",
            enforce_detection=False,
        )
    except Exception as exc:
        logger.warning("Face detection failed or DeepFace models missing: %s", exc)
        return _haar_detect_face(cv_img)

    if not faces:
        return {"detected": False, "count": 0, "faces": [], "largest_area": 0, "cropped_face": None}

    face_list = []
    for face in faces:
        area = face["facial_area"]
        x, y, w, h = area["x"], area["y"], area["w"], area["h"]
        face_list.append({"x": x, "y": y, "w": w, "h": h, "area": w * h})

    largest_face = max(face_list, key=lambda item: item["area"])
    x, y, w, h = largest_face["x"], largest_face["y"], largest_face["w"], largest_face["h"]
    cropped = cv_img[max(0, y):y + h, max(0, x):x + w]
    if cropped.size > 0:
        cropped = _normalize_lighting(cropped)

    return {
        "detected": True,
        "count": len(face_list),
        "faces": face_list,
        "largest_area": largest_face["area"],
        "cropped_face": cropped,
    }


def detect_liveness(image: Image.Image) -> dict:
    cv_img = _pil_to_cv(image)
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    signals = {}

    face_info = detect_face(image)
    signals["face_detected"] = face_info["detected"]
    signals["face_count"] = face_info.get("count", 0)
    if not face_info["detected"]:
        return {"liveness_score": 0.0, "signals": signals, "reason": "no_face_detected"}
    if face_info.get("count", 0) != 1:
        return {"liveness_score": 0.2, "signals": signals, "reason": "multiple_or_zero_faces"}

    cropped = face_info["cropped_face"]
    if cropped is not None and cropped.size > 0:
        eval_img = cropped
        eval_gray = cv2.cvtColor(cropped, cv2.COLOR_BGR2GRAY)
    else:
        eval_img = cv_img
        eval_gray = gray

    lap_var = float(cv2.Laplacian(eval_gray, cv2.CV_64F).var())
    signals["sharpness"] = float(f"{lap_var:.2f}")
    sharpness_score = min(1.0, lap_var / 200.0)

    _, bright_mask = cv2.threshold(eval_gray, 200, 255, cv2.THRESH_BINARY)
    specular_ratio = float(np.sum(bright_mask > 0)) / (eval_gray.shape[0] * eval_gray.shape[1] + 1e-6)
    signals["specular_ratio"] = float(f"{specular_ratio:.4f}")

    brightness = float(np.mean(eval_gray)) / 255.0
    signals["brightness"] = float(f"{brightness:.3f}")

    ycrcb = cv2.cvtColor(eval_img, cv2.COLOR_BGR2YCrCb)
    skin_mask = cv2.inRange(
        ycrcb,
        np.array([0, 133, 77], dtype=np.uint8),
        np.array([255, 180, 135], dtype=np.uint8),
    )
    skin_ratio = float(np.sum(skin_mask > 0)) / (skin_mask.shape[0] * skin_mask.shape[1] + 1e-6)
    signals["skin_ratio"] = float(f"{skin_ratio:.4f}")
    skin_score = min(1.0, skin_ratio * 3.0)

    brightness_score = 1.0 - min(1.0, abs(brightness - 0.55) / 0.55)
    score = (skin_score * 0.5) + (sharpness_score * 0.3) + (brightness_score * 0.2)
    return {"liveness_score": float(f"{score:.3f}"), "signals": signals}


def _offline_face_similarity(selfie_face: np.ndarray, doc_face: np.ndarray) -> dict:
    selfie_gray = cv2.cvtColor(cv2.resize(selfie_face, (192, 192)), cv2.COLOR_BGR2GRAY)
    doc_gray = cv2.cvtColor(cv2.resize(doc_face, (192, 192)), cv2.COLOR_BGR2GRAY)

    orb = cv2.ORB_create(nfeatures=512)
    kp1, des1 = orb.detectAndCompute(selfie_gray, None)
    kp2, des2 = orb.detectAndCompute(doc_gray, None)
    orb_score = 0.0
    if des1 is not None and des2 is not None and len(kp1) > 0 and len(kp2) > 0:
        matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = sorted(matcher.match(des1, des2), key=lambda item: item.distance)
        good = [item for item in matches if item.distance < 50]
        orb_score = min(1.0, len(good) / max(min(len(kp1), len(kp2)), 1))

    selfie_hist = cv2.normalize(cv2.calcHist([selfie_gray], [0], None, [256], [0, 256]), None).flatten()
    doc_hist = cv2.normalize(cv2.calcHist([doc_gray], [0], None, [256], [0, 256]), None).flatten()
    hist_corr = cv2.compareHist(selfie_hist, doc_hist, cv2.HISTCMP_CORREL)
    hist_score = max(0.0, min(1.0, (hist_corr + 1.0) / 2.0))

    edge1 = cv2.Canny(selfie_gray, 80, 160)
    edge2 = cv2.Canny(doc_gray, 80, 160)
    edge_score = 1.0 - min(1.0, np.mean(cv2.absdiff(edge1, edge2)) / 255.0)

    score = (orb_score * 0.55) + (hist_score * 0.25) + (edge_score * 0.20)
    return {
        "face_match_score": float(f"{score:.3f}"),
        "verified": score >= 0.68,
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
            "verified": score >= 0.68,
            "method": "opencv_sface",
            "cosine_similarity": float(f"{cosine:.4f}"),
        }
    except Exception as exc:
        logger.warning("SFace verification failed: %s", exc)
        return None


def match_faces(selfie: Image.Image, doc_image: Image.Image) -> dict:
    selfie_info = detect_face(selfie)
    doc_info = detect_face(doc_image)

    if not selfie_info["detected"] or not doc_info["detected"]:
        return {
            "face_match_score": 0.0,
            "verified": False,
            "error": "Face not detected in one or both images.",
            "method": "failed",
        }

    selfie_face = selfie_info["cropped_face"]
    doc_face = doc_info["cropped_face"]
    if selfie_face is None or doc_face is None:
        return {
            "face_match_score": 0.0,
            "verified": False,
            "method": "fallback_no_crop",
            "error": "Face crop could not be extracted for one or both images.",
        }

    sface_result = _sface_similarity(selfie_face, doc_face)
    if sface_result is not None:
        return sface_result

    deepface_error = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as file_one, tempfile.NamedTemporaryFile(
            suffix=".jpg", delete=False
        ) as file_two:
            selfie.save(file_one.name, format="JPEG")
            doc_image.save(file_two.name, format="JPEG")
            selfie_path = file_one.name
            doc_path = file_two.name

        try:
            try:
                result = _verify_with_deepface(selfie_path, doc_path)
            except Exception as exc:
                if not _is_corrupt_model_error(exc):
                    raise
                removed = _repair_deepface_cache()
                logger.warning("Repaired DeepFace cache after model read failure. Removed files: %s", removed)
                result = _verify_with_deepface(selfie_path, doc_path)

            distance = float(result.get("distance", 1.0))
            threshold = float(result.get("threshold", 0.4))
            verified = bool(result.get("verified", False))
            score = max(0.0, min(1.0, 1.0 - (distance / max(threshold * 2, 0.001))))
            return {
                "face_match_score": float(f"{score:.3f}"),
                "verified": verified,
                "distance": float(f"{distance:.4f}"),
                "threshold": threshold,
                "method": f"deepface_{str(result.get('resolved_model_name', 'model')).lower()}",
            }
        finally:
            os.unlink(selfie_path)
            os.unlink(doc_path)
    except Exception as exc:
        deepface_error = str(exc)
        logger.warning("DeepFace verification unavailable after SFace attempt: %s", exc)

    result = _offline_face_similarity(selfie_face, doc_face)
    if deepface_error:
        result["error"] = deepface_error
    return result
