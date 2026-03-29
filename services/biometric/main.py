import logging
import io
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from face_service import detect_face, detect_liveness, match_faces, warmup_biometric_models

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("biometric_main")
model_status = {
    "preferred_provider": "orb_histogram_ensemble",
    "deepface": {"available": False},
    "sface_ready": False,
    "sface_model_path": None,
}

app = FastAPI(title="AEGIS-KYC Biometric Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def preload_models():
    global model_status
    status = warmup_biometric_models()
    model_status = status
    if status.get("sface_ready"):
        logger.info(f"SFace biometric model ready: {status.get('sface_model_path')}")
    deepface_status = status.get("deepface", {})
    if deepface_status.get("available"):
        logger.info("DeepFace warmup completed.")
    elif status.get("sface_ready"):
        logger.info("DeepFace warmup unavailable, but OpenCV SFace is active as the primary alternative recognizer.")
    elif deepface_status.get("skipped"):
        logger.info("DeepFace warmup skipped because local weights are not installed. Advanced recognition needs SFace or DeepFace weights.")
    else:
        logger.warning(f"DeepFace warmup unavailable, offline fallback remains active: {deepface_status.get('error')}")


@app.get("/health")
def health():
    return {"status": "ok", "service": "biometric"}


@app.get("/model-status")
def get_model_status():
    return model_status


@app.post("/verify")
async def verify_biometric(
    selfie: UploadFile = File(...),
    doc_image: UploadFile = File(...)
):
    """
    Compare selfie with document photo and assess liveness.
    Returns face_match_score, liveness_score, and detailed signals.
    """
    try:
        selfie_bytes    = await selfie.read()
        doc_bytes       = await doc_image.read()
        selfie_img      = Image.open(io.BytesIO(selfie_bytes))
        doc_img         = Image.open(io.BytesIO(doc_bytes))
        selfie_img.load()
        doc_img.load()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot open image: {e}")

    # Keep enough detail for matching while preventing oversized uploads from stalling the API.
    selfie_img.thumbnail((768, 768))
    doc_img.thumbnail((768, 768))

    import asyncio

    logger.info(f"Biometric verify: selfie={selfie.filename} doc={doc_image.filename}")

    try:
        # Liveness check on selfie with timeout
        liveness_result = await asyncio.wait_for(
            asyncio.to_thread(detect_liveness, selfie_img),
            timeout=20.0
        )
        logger.info(f"Liveness score: {liveness_result['liveness_score']}")

        # Face match with timeout
        match_result = await asyncio.wait_for(
            asyncio.to_thread(match_faces, selfie_img, doc_img),
            timeout=25.0
        )
        logger.info(f"Face match score: {match_result['face_match_score']} method={match_result.get('method')}")
        
    except asyncio.TimeoutError:
        logger.error("Biometric processing timed out.")
        raise HTTPException(status_code=504, detail="Biometric processing timed out.")
    except Exception as e:
        logger.error(f"Biometric processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Internal processing error: {e}")

    return {
        "face_match_score": match_result["face_match_score"],
        "face_verified":    match_result.get("verified", False),
        "face_distance":    match_result.get("distance"),
        "match_method":     match_result.get("method"),
        "liveness_score":   liveness_result["liveness_score"],
        "liveness_signals": liveness_result["signals"],
    }


@app.post("/liveness")
async def check_liveness_only(file: UploadFile = File(...)):
    """Check liveness on a single selfie image."""
    raw = await file.read()
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot open image: {e}")
    img.thumbnail((1000, 1000))
    result = detect_liveness(img)
    return result
