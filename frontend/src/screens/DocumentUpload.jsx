import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

async function fileToOptimizedDataUrl(file, maxSide = 1600, quality = 0.86) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

  const image = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })

  const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

export default function DocumentUpload() {
  const navigate = useNavigate()
  const [panFile, setPanFile] = useState(null)
  const [aadhaarFile, setAadhaarFile] = useState(null)
  const [panPreview, setPanPreview] = useState(null)
  const [aadhaarPreview, setAadhaarPreview] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const panRef = useRef()
  const aadhaarRef = useRef()
  const adaptiveAuth = JSON.parse(sessionStorage.getItem('adaptiveAuth') || '{}')

  useEffect(() => {
    const sessionId = sessionStorage.getItem('kycSessionId')
    if (!sessionId) {
      navigate('/', { replace: true })
    }
  }, [navigate])

  useEffect(() => {
    return () => {
      if (panPreview) URL.revokeObjectURL(panPreview)
      if (aadhaarPreview) URL.revokeObjectURL(aadhaarPreview)
    }
  }, [panPreview, aadhaarPreview])

  const handleFile = (file, setter, previewSetter) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed.')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('Image is too large. Choose a smaller file.')
      return
    }

    setError('')
    setter(file)
    previewSetter(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  const handleContinue = async () => {
    if (!panFile || !aadhaarFile) {
      setError('Upload both PAN and Aadhaar images.')
      return
    }

    try {
      setSaving(true)
      const panDataUrl = await fileToOptimizedDataUrl(panFile)
      const aadhaarDataUrl = await fileToOptimizedDataUrl(aadhaarFile)
      sessionStorage.setItem('panDataUrl', panDataUrl)
      sessionStorage.setItem('panName', panFile.name)
      sessionStorage.setItem('aadhaarDataUrl', aadhaarDataUrl)
      sessionStorage.setItem('aadhaarName', aadhaarFile.name)
      navigate('/selfie')
    } catch {
      setError('Image processing failed. Try another photo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <div className="step-indicator">
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`step-dot ${i < 1 ? 'done' : i === 1 ? 'active' : ''}`} />
        ))}
        <span className="step-label">Step 2 of 5</span>
      </div>

      <h1 className="screen-title">Upload <span className="accent">Documents</span></h1>
      <p className="screen-subtitle">Upload PAN and Aadhaar images.</p>

      {adaptiveAuth.frictionMode === 'HIGH' && (
        <div className="banner-info">
          Extra checks are enabled for this session.
        </div>
      )}

      {error && <div className="banner-error">{error}</div>}
      {!error && (
        <div className="banner-info">
          Use clear front-side images.
        </div>
      )}

      <div className="upload-stack">
        <div className="form-group">
          <label className="form-label">PAN Card</label>
          <div className="upload-zone" onClick={() => panRef.current.click()}>
            <input ref={panRef} type="file" accept="image/*" onChange={e => handleFile(e.target.files[0], setPanFile, setPanPreview)} />
            {panPreview ? (
              <>
                <img src={panPreview} className="upload-preview" alt="PAN preview" />
                <p className="upload-filename">{panFile?.name}</p>
              </>
            ) : (
              <>
                <div className="upload-icon">PAN</div>
                <p className="upload-text"><strong>Click to upload</strong> PAN image</p>
              </>
            )}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Aadhaar Card</label>
          <div className="upload-zone" onClick={() => aadhaarRef.current.click()}>
            <input ref={aadhaarRef} type="file" accept="image/*" onChange={e => handleFile(e.target.files[0], setAadhaarFile, setAadhaarPreview)} />
            {aadhaarPreview ? (
              <>
                <img src={aadhaarPreview} className="upload-preview" alt="Aadhaar preview" />
                <p className="upload-filename">{aadhaarFile?.name}</p>
              </>
            ) : (
              <>
                <div className="upload-icon">AAD</div>
                <p className="upload-text"><strong>Click to upload</strong> Aadhaar image</p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="button-row">
        <button className="btn btn-primary" onClick={handleContinue} disabled={saving}>
          {saving ? 'Preparing images...' : 'Continue to Selfie'}
        </button>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>Back</button>
      </div>
    </div>
  )
}
