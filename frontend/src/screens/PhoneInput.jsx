import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { getStoredDeviceContext } from '../utils/device'

const STEPS = 5

export default function PhoneInput() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const validate = () => {
    if (!/^[6-9]\d{9}$/.test(phone)) return 'Enter a valid 10-digit Indian mobile number'
    if (!name.trim()) return 'Full name is required'
    return ''
  }

  const handleStart = async () => {
    const err = validate()
    if (err) {
      setError(err)
      return
    }

    setError('')
    setLoading(true)

    try {
      const deviceContext = getStoredDeviceContext()
      const res = await axios.post(
        '/kyc/start',
        { phone, name, deviceContext },
        { headers: { 'x-device-id': deviceContext.fingerprint } }
      )

      sessionStorage.setItem('kycSessionId', res.data.sessionId)
      sessionStorage.setItem('kycPhone', phone)
      sessionStorage.setItem('adaptiveAuth', JSON.stringify(res.data.adaptiveAuth || {}))
      navigate('/upload')
    } catch (e) {
      setError(e.response?.data?.error || 'Server error. Ensure backend is running.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <div className="step-indicator">
        {[...Array(STEPS)].map((_, i) => (
          <div key={i} className={`step-dot ${i === 0 ? 'active' : ''}`} />
        ))}
        <span className="step-label">Step 1 of 5</span>
      </div>

      <h1 className="screen-title">Identity <span className="accent">Verification</span></h1>
      <p className="screen-subtitle">Enter name and mobile number to begin.</p>

      {error && <div className="banner-error">{error}</div>}

      <div className="form-group">
        <label className="form-label">Full Name</label>
        <div className="input-wrapper">
          <span className="input-prefix input-prefix-compact">ID</span>
          <input
            className="input-text-compact"
            type="text"
            placeholder="e.g. Rajesh Kumar"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Mobile Number</label>
        <div className="input-wrapper">
          <span className="input-prefix">+91</span>
          <input
            type="tel"
            placeholder="9876543210"
            maxLength={10}
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && handleStart()}
          />
        </div>
      </div>

      <div className="banner-info">
        Keep PAN, Aadhaar, and camera ready.
      </div>

      <button className="btn btn-primary" onClick={handleStart} disabled={loading}>
        {loading ? 'Starting...' : 'Start KYC Verification'}
      </button>
    </div>
  )
}
