import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function SelfieCapture() {
  const navigate = useNavigate()
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const countdownRef = useRef(null)

  const [streaming, setStreaming] = useState(false)
  const [captured, setCaptured] = useState(null)
  const [camError, setCamError] = useState('')
  const [countdown, setCountdown] = useState(null)
  const [accessibilityMode, setAccessibilityMode] = useState(
    sessionStorage.getItem('accessibilityMode') === 'true'
  )

  useEffect(() => {
    const panDataUrl = sessionStorage.getItem('panDataUrl')
    const aadhaarDataUrl = sessionStorage.getItem('aadhaarDataUrl')
    if (!panDataUrl || !aadhaarDataUrl) {
      navigate('/upload', { replace: true })
    }
  }, [navigate])

  const startCamera = useCallback(async () => {
    setCamError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 540 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
      setStreaming(true)
    } catch (e) {
      setCamError('Camera access denied or unavailable. Please allow camera permission.')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
      setCountdown(null)
    }
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setStreaming(false)
  }, [])

  useEffect(() => {
    startCamera()
    return () => {
      stopCamera()
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [startCamera, stopCamera])

  const speak = (message) => {
    if (accessibilityMode && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(message))
    }
  }

  const capturePhoto = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    setCaptured(dataUrl)
    stopCamera()
  }

  const startCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    let count = 3
    setCountdown(count)
    speak('Camera ready. Capturing in 3 seconds.')
    countdownRef.current = setInterval(() => {
      count -= 1
      if (count === 0) {
        clearInterval(countdownRef.current)
        countdownRef.current = null
        setCountdown(null)
        capturePhoto()
      } else {
        setCountdown(count)
        speak(String(count))
      }
    }, 1000)
  }

  const retake = () => {
    setCaptured(null)
    startCamera()
  }

  const handleContinue = () => {
    if (!captured) return
    sessionStorage.setItem('selfieDataUrl', captured)
    sessionStorage.setItem('accessibilityMode', accessibilityMode ? 'true' : 'false')
    navigate('/processing')
  }

  return (
    <div className="card">
      <div className="step-indicator">
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`step-dot ${i < 2 ? 'done' : i === 2 ? 'active' : ''}`} />
        ))}
        <span className="step-label">Step 3 of 5</span>
      </div>

      <h1 className="screen-title">Live <span className="accent">Selfie</span></h1>
      <p className="screen-subtitle">Take one clear live selfie.</p>

      <label className="toggle-row">
        <input type="checkbox" checked={accessibilityMode} onChange={e => setAccessibilityMode(e.target.checked)} />
        <span>Enable audio-guided accessible capture</span>
      </label>

      {camError && <div className="banner-error">{camError}</div>}
      {!camError && (
        <div className="banner-info">
          Keep one face in frame.
        </div>
      )}

      {!captured ? (
        <>
          <div className="camera-container">
            <video ref={videoRef} autoPlay muted playsInline />
            <div className="camera-overlay" />
            <div className="camera-guide" />
            {countdown !== null && <div className="countdown-overlay">{countdown}</div>}
          </div>
          <p className="camera-hint">Look straight at the camera.</p>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <div className="button-row">
            <button className="btn btn-primary" onClick={startCountdown} disabled={!streaming || countdown !== null}>
              {countdown !== null ? `Capturing in ${countdown}...` : 'Capture Selfie'}
            </button>
            {camError && <button className="btn btn-secondary" onClick={startCamera}>Retry Camera</button>}
          </div>
        </>
      ) : (
        <>
          <img src={captured} className="captured-img" alt="Captured selfie" />
          <div className="button-row">
            <button className="btn btn-secondary btn-sm" onClick={retake}>Retake</button>
            <button className="btn btn-primary" onClick={handleContinue}>Use This and Continue</button>
          </div>
        </>
      )}

      <hr className="divider" />
      <button className="btn btn-secondary" onClick={() => navigate('/upload')}>Back</button>
    </div>
  )
}
