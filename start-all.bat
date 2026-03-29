@echo off
echo =======================================================
echo Starting AEGIS-KYC Full Environment Setup
echo This will take a moment if dependencies are missing.
echo =======================================================

echo.
echo [1/4] Setting up Document Microservice...
cd services\document
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)
call venv\Scripts\activate.bat
pip install -r requirements.txt --quiet
cd ..\..

echo.
echo [2/4] Setting up Biometric Microservice...
cd services\biometric
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)
call venv\Scripts\activate.bat
pip install -r requirements.txt --quiet
cd ..\..

echo.
echo [3/4] Setting up Backend API Gateway...
cd backend
call npm install --silent
cd ..

echo.
echo [4/4] Setting up Frontend UI...
cd frontend
call npm install --silent
cd ..

echo.
echo Launching all services in concurrent windows...
start "Document Microservice" cmd /k "cd services\document && call venv\Scripts\activate.bat && uvicorn main:app --port 8001 --reload"
start "Biometric Microservice" cmd /k "cd services\biometric && call venv\Scripts\activate.bat && uvicorn main:app --port 8002 --reload"
start "Backend API Gateway" cmd /k "cd backend && npm start"
start "Frontend UI" cmd /k "cd frontend && npm run dev"

echo.
echo =======================================================
echo All services started! Check the newly opened windows.
echo =======================================================
