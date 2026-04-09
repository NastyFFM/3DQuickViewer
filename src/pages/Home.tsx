import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateId, getSavedRoomId } from '../lib/storage';

export function Home() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const savedRoom = getSavedRoomId();

  const createRoom = () => {
    const roomId = generateId();
    navigate(`/room/${roomId}`);
  };

  const joinRoom = () => {
    if (joinCode.trim()) {
      navigate(`/room/${joinCode.trim().toUpperCase()}`);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0, color: '#fff' }}>
          🧊 3DQuickViewer
        </h1>
        <p style={{ color: '#888', fontSize: 16, marginTop: 8, marginBottom: 32 }}>
          3D-Modelle vom Desktop direkt in VR ansehen
        </p>

        <button onClick={createRoom} style={primaryBtnStyle}>
          Raum erstellen
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0' }}>
          <div style={{ flex: 1, height: 1, background: '#333' }} />
          <span style={{ color: '#666', fontSize: 13 }}>oder beitreten</span>
          <div style={{ flex: 1, height: 1, background: '#333' }} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Raum-Code eingeben"
            maxLength={6}
            style={inputStyle}
            onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
          />
          <button onClick={joinRoom} disabled={!joinCode.trim()} style={secondaryBtnStyle}>
            Beitreten
          </button>
        </div>

        {savedRoom && (
          <button
            onClick={() => navigate(`/room/${savedRoom}`)}
            style={{ ...secondaryBtnStyle, marginTop: 16, width: '100%' }}
          >
            Letzten Raum oeffnen ({savedRoom})
          </button>
        )}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0d0d1a',
  padding: 20,
};

const cardStyle: React.CSSProperties = {
  background: '#16162a',
  borderRadius: 20,
  padding: 40,
  maxWidth: 400,
  width: '100%',
  textAlign: 'center',
};

const primaryBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 24px',
  background: '#6c63ff',
  color: '#fff',
  border: 'none',
  borderRadius: 12,
  fontSize: 17,
  fontWeight: 700,
  cursor: 'pointer',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '12px 20px',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  border: '1px solid #333',
  borderRadius: 12,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '12px 16px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid #333',
  borderRadius: 12,
  color: '#fff',
  fontSize: 16,
  fontFamily: 'monospace',
  letterSpacing: 3,
  textAlign: 'center',
};
