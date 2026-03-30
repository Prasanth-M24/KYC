# AEGIS-KYC

AEGIS-KYC is a full-stack digital KYC and fraud-risk screening platform for banking-style onboarding. It combines document analysis, biometric verification, device intelligence, graph-based fraud checks, explainable risk scoring, and a reviewer-friendly final report.

This repository is structured so a new developer can clone or extract it, install the required services, configure environment variables, and run the system locally.

## What It Does

- Collects applicant identity details
- Uploads and verifies PAN and Aadhaar images
- Performs OCR and document tamper checks
- Captures and validates a live selfie
- Runs biometric face match and passive liveness checks
- Uses device context and graph risk for fraud screening
- Produces an explainable decision:
  - `APPROVED`
  - `REVIEW`
  - `REJECTED`
- Generates a simple KYC report for bank staff

## Tech Stack

### Frontend

- React 18
- Vite
- React Router
- Axios

### Backend

- Node.js
- Express
- Mongoose
- Neo4j Driver
- Multer

### AI / Verification Services

- Python
- FastAPI
- OpenCV
- OCR-based document analysis
- YOLOv11 face detection
- OpenCV SFace similarity matching
- DeepFace fallback

### Databases

- MongoDB for KYC session storage
- Neo4j for fraud graph analysis

## Repository Structure

```text
.
|-- backend/              # Node.js API gateway
|-- database/             # MongoDB and Neo4j setup scripts
|-- frontend/             # React/Vite frontend
|-- services/
|   |-- biometric/        # FastAPI biometric service
|   `-- document/         # FastAPI document verification service
|-- start-all.bat         # Windows convenience launcher
`-- README.md
```

## Prerequisites

Install the following before running the project:

- Node.js 18+
- Python 3.10+
- MongoDB 6+
- Neo4j 5+ (optional but recommended)
- Tesseract OCR 5+

### External Tools

- MongoDB Community Server: https://www.mongodb.com/try/download/community
- Neo4j: https://neo4j.com/download/
- Tesseract OCR for Windows: https://github.com/UB-Mannheim/tesseract/wiki

After installing Tesseract, make sure `tesseract` is available in your system `PATH`.

## Quick Start

If you are on Windows and want the easiest setup:

1. Clone the repo or extract the ZIP
2. Open a terminal in the project root
3. Configure the backend environment variables
4. Run:

```powershell
start-all.bat
```

This script installs missing dependencies and opens the services in separate windows.

## Manual Setup

### 1. Clone Or Extract

If using Git:

```bash
git clone <your-repository-url>
cd AEGIS-KYC
```

If using a ZIP:

1. Extract the archive
2. Open a terminal in the extracted project folder

### 2. Backend Setup

```bash
cd backend
npm install
```

### 3. Frontend Setup

```bash
cd frontend
npm install
```

### 4. Document Service Setup

#### Windows

```powershell
cd services\document
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

#### macOS / Linux

```bash
cd services/document
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 5. Biometric Service Setup

#### Windows

```powershell
cd services\biometric
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

#### macOS / Linux

```bash
cd services/biometric
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Environment Configuration

Create a file named `backend/.env` from `backend/.env.example`.

Example:

```env
MONGO_URI=mongodb://localhost:27017/aegis_kyc
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=change_me
NEO4J_DATABASE=neo4j
PORT=3001
DOC_SERVICE_URL=http://localhost:8001
BIO_SERVICE_URL=http://localhost:8002
UPLOAD_DIR=./uploads
NODE_ENV=development
```

Notes:

- `NEO4J_USER` and `NEO4J_USERNAME` are both supported by the codebase
- If you use Neo4j Aura, set `NEO4J_URI` to the Aura connection string such as `neo4j+s://...`
- Never commit real passwords or cloud database credentials

## Database Setup

Make sure MongoDB is running before starting the backend.

If you want to initialize database helpers:

```bash
cd database
node mongo_setup.js
node neo4j_setup.js
```

Neo4j is optional at startup, but without it the fraud graph checks will be reduced.

## Running The Application

Run each service in a separate terminal.

### Terminal 1: Document Service

#### Windows

```powershell
cd services\document
.\venv\Scripts\activate
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

#### macOS / Linux

```bash
cd services/document
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

### Terminal 2: Biometric Service

#### Windows

```powershell
cd services\biometric
.\venv\Scripts\activate
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

#### macOS / Linux

```bash
cd services/biometric
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

### Terminal 3: Backend

```bash
cd backend
npm start
```

### Terminal 4: Frontend

```bash
cd frontend
npm run dev
```

## URLs

Once running, the application is available at:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`
- Document service: `http://localhost:8001`
- Biometric service: `http://localhost:8002`

Health checks:

- `http://localhost:3001/health`
- `http://localhost:8001/health`
- `http://localhost:8002/health`

## Suggested First Test

1. Open the frontend in the browser
2. Enter a name and valid mobile number
3. Upload PAN and Aadhaar images
4. Capture a live selfie
5. Wait for the processing flow
6. Review the final decision and generated report

## OCR And Biometric Notes

### Tesseract OCR

The document service uses Tesseract. If OCR is weak or unavailable:

- verify `tesseract --version`
- ensure Tesseract is in `PATH`
- restart the document service after installation

### Biometric Model

The biometric service is configured to use a YOLOv11-assisted document and selfie face-matching pipeline.

Primary model flow:

- YOLOv11 face detection to crop the face from the selfie, PAN, and Aadhaar
- Best-document selection across PAN and Aadhaar
- OpenCV SFace embeddings for final similarity scoring

Fallback flow:

- DeepFace
- offline similarity fallback if advanced models are unavailable

Bundled local model paths:

```text
services/biometric/models/yolo11n_face_detection.onnx
services/biometric/models/face_recognition_sface_2021dec.onnx
```

## Troubleshooting

### Backend Starts But Logs Neo4j Warning

The app can still run, but fraud graph checks are reduced.

Check:

- Neo4j is running
- credentials in `backend/.env` are correct
- the URI matches local Neo4j or Aura

### Document Uploads Fail

Check:

- frontend and backend are both running
- upload size is reasonable
- `UPLOAD_DIR` is writable

### Biometric Service Returns Timeout

Check:

- the biometric service is running on port `8002`
- the SFace model file exists
- the camera image is not extremely large or corrupted

### OCR Is Not Reading Documents Correctly

Check:

- image quality
- lighting and glare
- Tesseract installation

## Security Notes

- Do not commit real `.env` files with secrets
- Rotate any credentials that were ever exposed in logs or chat history
- Restrict public access to reports and uploads before production deployment
- Use proper authentication and authorization for production banking workflows

## Current Prototype Scope

This repository is a strong local prototype, but production deployment would still require:

- secure user authentication and role-based access
- integration with official bank / KYC registries
- production infrastructure and monitoring
- audit retention and compliance hardening
- model calibration with real enterprise datasets
