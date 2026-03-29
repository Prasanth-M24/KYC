# AEGIS-KYC — AI-Powered Digital KYC System

A full-stack, locally-runnable KYC system using React, Node.js, Python FastAPI,
MongoDB, and Neo4j with real AI document forensics and facial biometrics.

---

## System Architecture

```
Frontend (React/Vite:5173)
       ↓ REST
Backend API Gateway (Node.js:3001)
       ↓                    ↓
Document Service      Biometric Service
  (Python:8001)         (Python:8002)
       ↓                    ↓
     MongoDB            Neo4j Graph
   (localhost:27017)  (localhost:7687)
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 18 | Backend + Frontend |
| Python | ≥ 3.10 | AI Services |
| MongoDB | ≥ 6 | Session storage |
| Neo4j | ≥ 5 | Fraud graph |
| Tesseract | 5.x | OCR engine |

### Install Tesseract (Windows)
Download from: https://github.com/UB-Mannheim/tesseract/wiki
Add to PATH. Verify: `tesseract --version`

### Install MongoDB
https://www.mongodb.com/try/download/community

### Install Neo4j Desktop
https://neo4j.com/download/

---

## Installation

### 1. Backend
```powershell
cd e:\IOB-Hack\KYC\backend
npm install
```

### 2. Document Forensic Service
```powershell
cd e:\IOB-Hack\KYC\services\document
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Biometric Service
```powershell
cd e:\IOB-Hack\KYC\services\biometric
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Frontend
```powershell
cd e:\IOB-Hack\KYC\frontend
npm install
```

### 5. Database Setup
```powershell
# MongoDB indexes (ensure MongoDB is running)
cd e:\IOB-Hack\KYC\database
node mongo_setup.js

# Neo4j schema (ensure Neo4j is running with password aegis1234)
node neo4j_setup.js
```

---

## Starting All Services

Open **5 separate terminals**:

**Terminal 1 — Backend**
```powershell
cd e:\IOB-Hack\KYC\backend
npm run dev
# Running on http://localhost:3001
```

**Terminal 2 — Document Service**
```powershell
cd e:\IOB-Hack\KYC\services\document
.\venv\Scripts\activate
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
# Running on http://localhost:8001
```

**Terminal 3 — Biometric Service**
```powershell
cd e:\IOB-Hack\KYC\services\biometric
.\venv\Scripts\activate
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
# Running on http://localhost:8002
```

**Terminal 4 — Frontend**
```powershell
cd e:\IOB-Hack\KYC\frontend
npm run dev
# Running on http://localhost:5173
```

---

## Environment Variables (backend/.env)

```env
MONGO_URI=mongodb://localhost:27017/aegis_kyc
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=aegis1234
PORT=3001
DOC_SERVICE_URL=http://localhost:8001
BIO_SERVICE_URL=http://localhost:8002
UPLOAD_DIR=./uploads
```

---

## Sample Test Flow

1. Open http://localhost:5173
2. Enter your **name** and **phone** (e.g. 9876543210)
3. Upload any **PAN card image** and **Aadhaar card image** (JPEG/PNG)
4. Take a **live selfie** using your webcam
5. Watch the processing screen run all AI engines
6. View the **result** — APPROVED / REVIEW / REJECTED

### API Test (curl)
```bash
# Start session
curl -X POST http://localhost:3001/kyc/start \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","name":"Test User"}'

# Health checks
curl http://localhost:3001/health
curl http://localhost:8001/health
curl http://localhost:8002/health
```

---

## Risk Scoring Logic

| Signal | Penalty |
|--------|---------|
| Face match < 70% | +40 |
| Liveness < 50% | +30 |
| Invalid documents | +20 |
| Neo4j fraud flag | +30 |

| Risk Score | Decision |
|------------|----------|
| 0 – 29 | ✅ APPROVED |
| 30 – 70 | 🔍 REVIEW |
| > 70 | ❌ REJECTED |

**Fraud Rule**: A device linked to > 3 different users is flagged as fraudulent.

---

## Folder Structure

```
e:\IOB-Hack\KYC\
├── backend\
│   ├── server.js
│   ├── package.json
│   ├── .env
│   ├── controllers\kycController.js
│   ├── routes\kyc.js
│   ├── models\KycSession.js
│   ├── middleware\upload.js
│   ├── services\
│   │   ├── mongoService.js
│   │   ├── neo4jService.js
│   │   └── riskEngine.js
│   └── utils\logger.js
│
├── services\
│   ├── document\
│   │   ├── main.py           (FastAPI)
│   │   ├── forensic_service.py
│   │   └── requirements.txt
│   └── biometric\
│       ├── main.py           (FastAPI)
│       ├── face_service.py
│       └── requirements.txt
│
├── frontend\
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   └── src\
│       ├── App.jsx
│       ├── main.jsx
│       ├── index.css
│       ├── components\Header.jsx
│       └── screens\
│           ├── PhoneInput.jsx
│           ├── DocumentUpload.jsx
│           ├── SelfieCapture.jsx
│           ├── Processing.jsx
│           └── Result.jsx
│
└── database\
    ├── neo4j_setup.js
    └── mongo_setup.js
```

---

## Notes

- **DeepFace** will download model weights (~100MB) on first run. Subsequent runs use the cache.
- If Neo4j is not running, the backend logs a warning and continues **without** fraud graph checks (fraud_flag = false).
- Tesseract path on Windows: ensure `tesseract.exe` is in PATH. If not, set `pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'` in forensic_service.py.
- The biometric service falls back to **histogram matching** if DeepFace models fail to load.
