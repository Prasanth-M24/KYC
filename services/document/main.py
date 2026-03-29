import io
import logging
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from forensic_service import analyze_document


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("document_main")

app = FastAPI(title="AEGIS-KYC Document Forensic Service", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "document"}


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    doc_type: str = Form(...),
):
    raw = await file.read()
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot open image: {exc}") from exc

    image.thumbnail((1600, 1600))
    logger.info("Document analyze request: doc_type=%s filename=%s", doc_type, file.filename)

    try:
        result = analyze_document(
            image=image,
            filename=file.filename or "upload",
            content_type=file.content_type or "",
            doc_type=doc_type,
            raw_bytes=raw,
        )
    except Exception as exc:
        logger.exception("Document analysis failed")
        raise HTTPException(status_code=500, detail=f"Document analysis failed: {exc}") from exc

    return result
