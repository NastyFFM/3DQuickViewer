import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onReset: () => void;
}

interface State {
  hasError: boolean;
  error: string | null;
}

export class ViewerErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error) {
    console.error('[3DQV] Viewer error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          background: '#1a1a2e',
          color: '#888',
          padding: 32,
          textAlign: 'center',
          gap: 16,
        }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <div style={{ fontSize: 16 }}>Viewer konnte nicht geladen werden</div>
          <div style={{ fontSize: 13, color: '#555' }}>{this.state.error}</div>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset();
            }}
            style={{
              padding: '10px 20px',
              background: '#6c63ff',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Erneut versuchen
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
