import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Header from './components/Header'
import JourneyAside from './components/JourneyAside'
import PhoneInput from './screens/PhoneInput'
import DocumentUpload from './screens/DocumentUpload'
import SelfieCapture from './screens/SelfieCapture'
import Processing from './screens/Processing'
import Result from './screens/Result'

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-wrapper">
        <Header />
        <main className="main-container">
          <div className="page-shell">
            <JourneyAside />
            <Routes>
              <Route path="/" element={<PhoneInput />} />
              <Route path="/upload" element={<DocumentUpload />} />
              <Route path="/selfie" element={<SelfieCapture />} />
              <Route path="/processing" element={<Processing />} />
              <Route path="/result/:id" element={<Result />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  )
}
