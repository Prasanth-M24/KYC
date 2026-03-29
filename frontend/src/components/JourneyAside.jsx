import { useLocation } from 'react-router-dom'

const CONTENT = {
  '/': {
    eyebrow: 'Start',
    title: 'Enter details to begin.',
    copy: 'Keep PAN, Aadhaar, and camera ready.',
    chips: ['Secure session', 'Quick start'],
  },
  '/upload': {
    eyebrow: 'Upload',
    title: 'Add clear document images.',
    copy: 'Full-frame images help checks finish faster.',
    chips: ['PAN', 'Aadhaar', 'Clear image'],
  },
  '/selfie': {
    eyebrow: 'Selfie',
    title: 'Take one clear live selfie.',
    copy: 'Keep one face in frame and good lighting.',
    chips: ['One face', 'Good light', 'Live capture'],
  },
  '/processing': {
    eyebrow: 'Processing',
    title: 'Verification is in progress.',
    copy: 'Please wait while the checks complete.',
    chips: ['Documents', 'Biometric', 'Risk score'],
  },
  result: {
    eyebrow: 'Result',
    title: 'Review the decision and report.',
    copy: 'Download the final KYC report if needed.',
    chips: ['Decision', 'Report', 'Session'],
  },
}

export default function JourneyAside() {
  const location = useLocation()
  const key = location.pathname.startsWith('/result/') ? 'result' : location.pathname
  const content = CONTENT[key] || CONTENT['/']

  return (
    <aside className="page-aside">
      <div className="eyebrow">{content.eyebrow}</div>
      <h1 className="page-title">{content.title}</h1>
      <p className="page-copy">{content.copy}</p>
      <div className="trust-strip">
        {content.chips.map((chip) => (
          <span key={chip} className="trust-chip">{chip}</span>
        ))}
      </div>
    </aside>
  )
}
