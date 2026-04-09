import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { DropZone } from '../components/DropZone';
import { ModelGallery } from '../components/ModelGallery';
import { ModelViewer } from '../components/ModelViewer';
import { VRScene } from '../components/VRScene';
import { useModels } from '../hooks/useModels';
import { useRoom } from '../hooks/useRoom';
import type { StoredModel } from '../types';

export function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { models, addModelFromFile, deleteModelById, refresh } = useModels();
  const [viewing, setViewing] = useState<StoredModel | null>(null);
  const [vrMode, setVrMode] = useState(false);
  const [isHost] = useState(() => {
    // First visitor to a room becomes host
    const key = `3dqv-host-${roomId}`;
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, 'true');
      return true;
    }
    return true; // In same browser, always host
  });

  const {
    connected,
    peers,
    remoteModels,
    transfers,
    requestModel,
    sendModelToPeers,
    broadcastModelList,
    error,
  } = useRoom({ roomId: roomId!, isHost, enabled: !!roomId });

  const handleFile = useCallback(async (file: File) => {
    await addModelFromFile(file, roomId);
    broadcastModelList();
  }, [addModelFromFile, roomId, broadcastModelList]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteModelById(id);
    broadcastModelList();
    if (viewing?.id === id) setViewing(null);
  }, [deleteModelById, broadcastModelList, viewing]);

  const handleDownload = useCallback(async (modelId: string) => {
    requestModel(modelId);
  }, [requestModel]);

  const handleSend = useCallback(async (modelId: string) => {
    await sendModelToPeers(modelId);
  }, [sendModelToPeers]);

  // Refresh models when a transfer completes (transfers array shrinks)
  const [prevTransferCount, setPrevTransferCount] = useState(0);
  useEffect(() => {
    if (transfers.length < prevTransferCount && prevTransferCount > 0) {
      // A transfer just completed — refresh immediately
      refresh();
    }
    setPrevTransferCount(transfers.length);
  }, [transfers.length, prevTransferCount, refresh]);

  // Also refresh periodically (to catch newly received ones)
  useEffect(() => {
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [refresh]);

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/room/${roomId}`
    : '';

  if (!roomId) {
    navigate('/');
    return null;
  }

  // Viewing a model in VR
  if (viewing && vrMode) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: '#0d0d1a' }}>
        <button
          onClick={() => setVrMode(false)}
          style={backBtnStyle}
        >
          Zurueck
        </button>
        <VRScene modelData={viewing.data} fileName={viewing.fileName} />
      </div>
    );
  }

  // Viewing a model in 3D preview
  if (viewing) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: '#0d0d1a', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => setViewing(null)} style={backBtnStyle}>Zurueck</button>
          <h2 style={{ color: '#fff', margin: 0, fontSize: 18 }}>{viewing.name}</h2>
          <div style={{ flex: 1 }} />
          <button onClick={() => setVrMode(true)} style={vrBtnStyle}>
            🥽 VR-Modus
          </button>
        </div>
        <div style={{ flex: 1 }}>
          <ModelViewer modelData={viewing.data} fileName={viewing.fileName} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d1a', color: '#fff' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #222' }}>
        <button onClick={() => navigate('/')} style={{ ...backBtnStyle, padding: '6px 12px', fontSize: 13 }}>
          Startseite
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
          🧊 Raum {roomId}
        </h1>
        <div style={{ flex: 1 }} />
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          borderRadius: 20,
          background: connected ? 'rgba(46,125,50,0.2)' : 'rgba(255,152,0,0.2)',
          fontSize: 13,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#4caf50' : '#ff9800',
          }} />
          {connected ? `Verbunden (${peers.length} Geraet${peers.length !== 1 ? 'e' : ''})` : 'Verbinde...'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, padding: 24, flexWrap: 'wrap' }}>
        {/* Left: Upload + QR */}
        <div style={{ flex: '0 0 320px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <DropZone onFile={handleFile} />

          <div style={{
            background: '#16162a',
            borderRadius: 16,
            padding: 24,
            textAlign: 'center',
          }}>
            <div style={{ marginBottom: 12, fontSize: 14, color: '#888' }}>
              Quest verbinden:
            </div>
            <div style={{
              background: '#fff',
              borderRadius: 12,
              padding: 16,
              display: 'inline-block',
            }}>
              <QRCodeSVG value={shareUrl} size={180} />
            </div>
            <div style={{
              marginTop: 12,
              fontFamily: 'monospace',
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 4,
              color: '#6c63ff',
            }}>
              {roomId}
            </div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
              {shareUrl}
            </div>
          </div>

          {error && (
            <div style={{ background: 'rgba(211,47,47,0.15)', borderRadius: 12, padding: 12, color: '#ff4444', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        {/* Right: Gallery */}
        <div style={{ flex: 1, minWidth: 300 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 16 }}>
            Meine Modelle
          </h2>
          <ModelGallery
            localModels={models}
            remoteModels={remoteModels}
            transfers={transfers}
            onView={setViewing}
            onDelete={handleDelete}
            onSend={handleSend}
            onDownload={handleDownload}
            showSend={peers.length > 0}
            showDownload={true}
          />
        </div>
      </div>
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  border: '1px solid #333',
  borderRadius: 8,
  fontSize: 14,
  cursor: 'pointer',
};

const vrBtnStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: '#6c63ff',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
};
