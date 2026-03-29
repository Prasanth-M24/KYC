import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { getOptionalGeolocation, getStoredDeviceContext } from '../utils/device'

const STEPS_LABELS = [
  { key: 'uploading', label: 'Uploading documents to server...' },
  { key: 'ocr', label: 'Running OCR and document forensics...' },
  { key: 'selfie', label: 'Uploading selfie...' },
  { key: 'biometric', label: 'Running facial biometric match...' },
  { key: 'fraud', label: 'Querying fraud graph database...' },
  { key: 'risk', label: 'Calculating risk score...' },
]

function dataUrlToFile(dataUrl, filename) {
  const arr = dataUrl.split(',')
  const mime = arr[0].match(/:(.*?);/)[1]
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) u8arr[n] = bstr.charCodeAt(n)
  return new File([u8arr], filename, { type: mime })
}

export default function Processing() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [doneSteps, setDoneSteps] = useState([])
  const [error, setError] = useState('')
  const executed = useRef(false)
  const progress = Math.round(((doneSteps.length + (error ? 0 : 0.35)) / STEPS_LABELS.length) * 100)

  useEffect(() => {
    if (executed.current) return
    executed.current = true
    runKyc()
  }, [])

  useEffect(() => {
    const sessionId = sessionStorage.getItem('kycSessionId')
    const panDataUrl = sessionStorage.getItem('panDataUrl')
    const aadhaarDataUrl = sessionStorage.getItem('aadhaarDataUrl')
    const selfieDataUrl = sessionStorage.getItem('selfieDataUrl')
    if (!sessionId || !panDataUrl || !aadhaarDataUrl || !selfieDataUrl) {
      navigate('/', { replace: true })
    }
  }, [navigate])

  const advanceStep = (idx) => {
    setCurrentStep(idx + 1)
    setDoneSteps(prev => [...prev, idx])
  }

  const runKyc = async () => {
    const sessionId = sessionStorage.getItem('kycSessionId')
    const panDataUrl = sessionStorage.getItem('panDataUrl')
    const panName = sessionStorage.getItem('panName') || 'pan.jpg'
    const aadDataUrl = sessionStorage.getItem('aadhaarDataUrl')
    const aadName = sessionStorage.getItem('aadhaarName') || 'aadhaar.jpg'
    const selfieUrl = sessionStorage.getItem('selfieDataUrl')
    const accessibilityMode = sessionStorage.getItem('accessibilityMode') === 'true'
    const deviceContext = getStoredDeviceContext()

    if (!sessionId || !panDataUrl || !aadDataUrl || !selfieUrl) {
      setError('Session data missing. Please restart KYC.')
      return
    }

    try {
      setCurrentStep(0)
      const docForm = new FormData()
      docForm.append('sessionId', sessionId)
      docForm.append('pan', dataUrlToFile(panDataUrl, panName))
      docForm.append('aadhaar', dataUrlToFile(aadDataUrl, aadName))
      advanceStep(0)
      await new Promise(resolve => setTimeout(resolve, 400))
      setCurrentStep(1)
      await axios.post('/kyc/upload-docs', docForm, {
        headers: { 'x-device-id': deviceContext.fingerprint }
      })
      advanceStep(1)

      await new Promise(resolve => setTimeout(resolve, 300))
      setCurrentStep(2)
      const selfieForm = new FormData()
      selfieForm.append('sessionId', sessionId)
      selfieForm.append('selfie', dataUrlToFile(selfieUrl, 'selfie.jpg'))
      selfieForm.append('accessibilityMode', accessibilityMode ? 'true' : 'false')
      const geolocation = await getOptionalGeolocation()
      if (geolocation) {
        selfieForm.append('geolocation', JSON.stringify(geolocation))
      }
      advanceStep(2)

      setCurrentStep(3)
      await axios.post('/kyc/verify-face', selfieForm, {
        headers: { 'x-device-id': deviceContext.fingerprint }
      })
      advanceStep(3)

      setCurrentStep(4)
      await new Promise(resolve => setTimeout(resolve, 500))
      advanceStep(4)
      setCurrentStep(5)
      await new Promise(resolve => setTimeout(resolve, 300))
      advanceStep(5)

      navigate(`/result/${sessionId}`)
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Processing failed. Check that all services are running.')
    }
  }

  return (
    <div className="card">
      <div className="step-indicator">
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`step-dot ${i < 3 ? 'done' : i === 3 ? 'active' : ''}`} />
        ))}
        <span className="step-label">Step 4 of 5</span>
      </div>

      <div className="processing-container">
        <div className="spinner-ring" />
        <h2 className="screen-title text-center">
          <span className="accent">Verifying</span> Identity
        </h2>
        <p className="screen-subtitle text-center">
          The intake, forensic, biometric, graph, and risk engines are processing your onboarding request.
        </p>

        {error && <div className="banner-error">{error}</div>}

        {!error && (
          <div className="progress-shell">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
            <div className="progress-caption">
              <span>Progress</span>
              <strong>{Math.min(progress, 100)}%</strong>
            </div>
          </div>
        )}

        <ul className="processing-steps">
          {STEPS_LABELS.map((s, i) => (
            <li key={s.key} className={`processing-step ${doneSteps.includes(i) ? 'done' : i === currentStep ? 'active' : ''}`}>
              <span className="step-icon">
                {doneSteps.includes(i) ? 'OK' : i === currentStep ? '...' : 'o'}
              </span>
              {s.label}
            </li>
          ))}
        </ul>

        {error && (
          <div className="button-row">
            <button className="btn btn-secondary" onClick={() => navigate('/selfie')}>Go back to selfie</button>
          </div>
        )}
      </div>
    </div>
  )
}
