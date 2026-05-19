import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', color: '#f8fafc', fontFamily: 'sans-serif', textAlign: 'center' }}>
          <h2>Ошибка загрузки</h2>
          <p style={{ opacity: 0.7 }}>{String(this.state.error)}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '1rem', padding: '0.75rem 2rem', borderRadius: '8px', border: 'none', background: '#2563eb', color: '#fff', fontSize: '1rem', cursor: 'pointer' }}
          >
            Перезагрузить
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
