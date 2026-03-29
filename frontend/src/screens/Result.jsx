import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'

const ICONS = { APPROVED: 'PASS', REVIEW: 'REVIEW', REJECTED: 'STOP' }
const LABELS = { APPROVED: 'Identity Verified', REVIEW: 'Manual Review Required', REJECTED: 'Verification Failed' }
const SUBTITLES = {
  APPROVED: 'Verification complete.',
  REVIEW: 'Review is required.',
  REJECTED: 'Verification could not be completed.'
}

function riskClass(risk) {
  if (risk < 30) return 'low'
  if (risk <= 70) return 'medium'
  return 'high'
}

function scoreClass(score, low = 0.7) {
  if (score >= low) return 'good'
  if (score >= low * 0.7) return 'warn'
  return 'bad'
}

function customerSummary(decision) {
  if (decision === 'APPROVED') return 'KYC checks completed successfully.'
  if (decision === 'REJECTED') return 'The submission did not pass the required checks.'
  return 'The case should be reviewed by a bank employee.'
}

function fraudFlagInfo(fraudFlag, riskScore) {
  if (fraudFlag) {
    return {
      key: 'flagged',
      title: 'Flagged',
      description: 'Fraud-related signals were detected. A bank employee should inspect this case before approval.',
    }
  }

  if (riskScore >= 45) {
    return {
      key: 'monitor',
      title: 'Monitor',
      description: 'No direct fraud hit was found, but the overall risk is elevated and worth watching.',
    }
  }

  return {
    key: 'clear',
    title: 'Clear',
    description: 'No fraud-linked signal was raised for this session.',
  }
}

export default function Result() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reportError, setReportError] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    axios.get(`/kyc/result/${id}`)
      .then(response => {
        setData(response.data)
        setLoading(false)
      })
      .catch(e => {
        setError(e.response?.data?.error || 'Failed to load result')
        setLoading(false)
      })
  }, [id])

  if (loading) {
    return (
      <div className="card text-center">
        <div className="spinner-ring" />
        <p className="screen-subtitle">Loading result...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <div className="banner-error">{error}</div>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>Start over</button>
      </div>
    )
  }

  const decision = data.decision || 'REVIEW'
  const riskScore = data.riskScore ?? 50
  const faceScore = data.bioResult?.face_match_score ?? 0
  const livScore = data.bioResult?.liveness_score ?? 0
  const docValid = data.docResult?.pan?.valid && data.docResult?.aadhaar?.valid
  const fraudFlag = data.fraudFlag
  const riskPct = Math.min(100, riskScore)
  const riskCls = riskClass(riskScore)
  const reviewerReport = data.reviewerReport
  const fraudInfo = fraudFlagInfo(fraudFlag, riskScore)

  const handleDownloadReport = async () => {
    try {
      setDownloading(true)
      setReportError('')
      let reportData = report
      if (!reportData) {
        const response = await axios.get(`/kyc/report/${id}`)
        reportData = response.data
        setReport(reportData)
      }

      const lines = [
        'AEGIS KYC REPORT',
        `Session ID: ${data.sessionId}`,
        `Decision: ${decision}`,
        `Risk Score: ${riskScore}/100`,
        `Face Match: ${(faceScore * 100).toFixed(0)}%`,
        `Liveness: ${(livScore * 100).toFixed(0)}%`,
        `Document Status: ${docValid ? 'VALID' : 'INVALID'}`,
        `Fraud Flag: ${fraudFlag ? 'FLAGGED' : 'CLEAR'}`,
        '',
        'Summary:',
        reportData?.report?.summary || customerSummary(decision),
        '',
        'Employee Action:',
        reportData?.report?.employeeAction || reviewerReport?.employeeAction || 'Review required',
      ]

      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `kyc-report-${data.sessionId}.txt`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      setReportError('Failed to generate KYC report.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="card">
      <div className="step-indicator">
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`step-dot ${i < 4 ? 'done' : 'active'}`} />
        ))}
        <span className="step-label">Step 5 of 5</span>
      </div>

      <div className={`result-banner ${decision.toLowerCase()}`}>
        <div className="result-icon">{ICONS[decision]}</div>
        <div className={`result-title ${decision.toLowerCase()}`}>{LABELS[decision]}</div>
        <div className="result-subtitle">{SUBTITLES[decision]}</div>
      </div>

      <div className="result-summary">
        <strong>Summary</strong>
        <span>{customerSummary(decision)}</span>
      </div>

      <div className={`fraud-panel fraud-panel-${fraudInfo.key}`}>
        <div className="fraud-panel-header">
          <strong>Fraud Flag Status</strong>
          <span className={`fraud-badge fraud-badge-${fraudInfo.key}`}>{fraudInfo.title}</span>
        </div>
        <p className="fraud-panel-copy">{fraudInfo.description}</p>
        <div className="fraud-options">
          <div className={`fraud-option ${fraudInfo.key === 'clear' ? 'active' : ''}`}>
            <strong>Clear</strong>
            <span>No fraud signal found.</span>
          </div>
          <div className={`fraud-option ${fraudInfo.key === 'monitor' ? 'active' : ''}`}>
            <strong>Monitor</strong>
            <span>Watch this case more closely.</span>
          </div>
          <div className={`fraud-option ${fraudInfo.key === 'flagged' ? 'active' : ''}`}>
            <strong>Flagged</strong>
            <span>Manual review is strongly advised.</span>
          </div>
        </div>
      </div>

      <div className="risk-bar-wrap">
        <div className="risk-bar-label">
          <span>Risk Score</span>
          <strong>{riskScore} / 100</strong>
        </div>
        <div className="risk-bar-track">
          <div className={`risk-bar-fill ${riskCls}`} style={{ width: `${riskPct}%` }} />
        </div>
      </div>

      <div className="result-metrics">
        <div className="metric-card">
          <div className="metric-label">Face Match</div>
          <div className={`metric-value ${scoreClass(faceScore, 0.7)}`}>{(faceScore * 100).toFixed(0)}%</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Liveness</div>
          <div className={`metric-value ${scoreClass(livScore, 0.5)}`}>{(livScore * 100).toFixed(0)}%</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Document</div>
          <div className={`metric-value ${docValid ? 'good' : 'bad'}`}>{docValid ? 'VALID' : 'INVALID'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Fraud Flag</div>
          <div className={`metric-value ${fraudFlag ? 'bad' : 'good'}`}>{fraudFlag ? 'FLAGGED' : 'CLEAR'}</div>
        </div>
      </div>

      {data.docResult?.pan?.extracted?.pan_number && (
        <div className="banner-info">
          PAN: <strong>{data.docResult.pan.extracted.pan_number}</strong>
        </div>
      )}
      {data.docResult?.aadhaar?.extracted?.aadhaar_number && (
        <div className="banner-info">
          Aadhaar: <strong>XXXX-XXXX-{data.docResult.aadhaar.extracted.aadhaar_number.slice(-4)}</strong>
        </div>
      )}
      {data.riskBreakdown && (
        <div className="audit-panel">
          <div className="audit-title">Decision Audit</div>
          {Object.entries(data.riskBreakdown).map(([key, value]) => (
            <div key={key} className="audit-row">
              <span>{key.replace(/_/g, ' ')}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
      {reviewerReport && (
        <div className="audit-panel">
          <div className="audit-title">Bank Employee Report</div>
          <div className="audit-row">
            <span>Recommendation</span>
            <strong>{reviewerReport.compliance?.recommendation || decision}</strong>
          </div>
          <div className="audit-row">
            <span>Employee action</span>
            <strong>{reviewerReport.employeeAction}</strong>
          </div>
        </div>
      )}

      <div className="session-id">Session ID: {data.sessionId}</div>
      {reportError && <div className="banner-error">{reportError}</div>}

      <hr className="divider" />
      <div className="button-row">
        <button className="btn btn-primary" onClick={handleDownloadReport} disabled={downloading}>
          {downloading ? 'Generating report...' : 'Download KYC Report'}
        </button>
        <button className="btn btn-secondary" onClick={() => {
          sessionStorage.clear()
          navigate('/')
        }}>
          Start New KYC
        </button>
      </div>
    </div>
  )
}
