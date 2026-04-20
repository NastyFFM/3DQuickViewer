import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { DropZone } from '../components/DropZone';
import { ModelGallery } from '../components/ModelGallery';
import { ModelViewer } from '../components/ModelViewer';
import { ARViewer } from '../components/ARViewer';
import { VRScene } from '../components/VRScene';
import { XRViewer } from '../components/XRViewer';
import { RoomScanViewer } from '../components/RoomScanViewer';
import { ViewerErrorBoundary } from '../components/ViewerErrorBoundary';
import { useModels } from '../hooks/useModels';
import { useRoom } from '../hooks/useRoom';
import type { StoredModel } from '../types';

export function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { models, addModelFromFile, deleteModelById, refresh } = useModels();
  const [viewing, setViewing] = useState<StoredModel | null>(null);
  const [viewMode, setViewMode] = useState<'3d' | 'ar' | 'xr' | 'vr'>('3d');
  const [modelScale, setModelScale] = useState(100); // percentage, 50-200
  const [showScan, setShowScan] = useState(false);
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
    lastReceived,
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

  const handleSave = useCallback((model: StoredModel) => {
    const blob = new Blob([model.data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = model.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Refresh models immediately when a model is received via P2P
  useEffect(() => {
    if (lastReceived > 0) {
      refresh();
    }
  }, [lastReceived, refresh]);

  // NO periodic polling — it reads all ArrayBuffers from IndexedDB
  // and blocks the main thread, causing XR tracking stutter.
  // Models refresh on: mount, file upload, P2P receive, delete.

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${import.meta.env.BASE_URL}room/${roomId}`
    : '';

  if (!roomId) {
    navigate('/');
    return null;
  }

  // Room scan mode
  if (showScan) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: '#0d0d1a', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid #222' }}>
          <button onClick={() => setShowScan(false)} style={backBtnStyle}>Zurueck</button>
          <h2 style={{ color: '#fff', margin: 0, fontSize: 16 }}>Room Scan</h2>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ViewerErrorBoundary onReset={() => setShowScan(false)}>
            <RoomScanViewer />
          </ViewerErrorBoundary>
        </div>
      </div>
    );
  }

  // Viewing a model
  if (viewing) {
    const isGlb = viewing.fileName.toLowerCase().endsWith('.glb') || viewing.fileName.toLowerCase().endsWith('.gltf');
    const isXR = viewMode === 'xr' || viewMode === 'vr';
    const scaleFactor = modelScale / 100;

    return (
      <div style={{ width: '100vw', height: '100vh', background: '#0d0d1a', display: 'flex', flexDirection: 'column' }}>

        {/* ===== XR MODE: hidden canvas + full gallery ===== */}
        {isXR ? (
          <>
            {/* Top bar: scale slider only */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
              background: '#111', borderBottom: '1px solid #333',
            }}>
              <button onClick={() => { setViewing(null); setViewMode('3d'); }} style={{ ...backBtnStyle, padding: '8px 14px', fontSize: 14 }}>Zurueck</button>
              <div style={{ flex: 1 }} />
              <span style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>{modelScale}%</span>
              <input type="range" min={50} max={200} value={modelScale}
                onChange={(e) => setModelScale(Number(e.target.value))}
                style={{ width: 140, accentColor: '#6c63ff' }} />
            </div>

            {/* Canvas hidden but stays in DOM so XR session keeps running */}
            <div style={{ height: 1, overflow: 'hidden', opacity: 0 }}>
              <ViewerErrorBoundary onReset={() => setViewMode('3d')}>
                {viewMode === 'xr' && <XRViewer modelData={viewing.data} fileName={viewing.fileName} scale={scaleFactor} />}
                {viewMode === 'vr' && <VRScene modelData={viewing.data} fileName={viewing.fileName} scale={scaleFactor} />}
              </ViewerErrorBoundary>
            </div>

            {/* Full-screen model gallery */}
            <div style={{ flex: 1, overflow: 'auto', padding: 16, background: '#0d0d1a' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 12,
              }}>
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setViewing(m)}
                    style={{
                      background: m.id === viewing.id ? '#6c63ff' : 'rgba(255,255,255,0.08)',
                      color: '#fff',
                      border: m.id === viewing.id ? '2px solid #9c8fff' : '2px solid #333',
                      borderRadius: 16,
                      padding: '20px 16px',
                      fontSize: 18,
                      fontWeight: m.id === viewing.id ? 700 : 500,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 28 }}>🧊</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.name}
                    </span>
                    <span style={{ fontSize: 12, color: m.id === viewing.id ? '#c8c0ff' : '#666' }}>
                      {(m.fileSize / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* ===== NON-XR MODE: Normal layout ===== */
          <>
            <div style={{ padding: '6px 12px', display: 'flex', gap: 6, alignItems: 'center', borderBottom: '1px solid #222', flexWrap: 'wrap' }}>
              <button onClick={() => { setViewing(null); setViewMode('3d'); }} style={backBtnStyle}>Zurueck</button>
              <h2 style={{ color: '#fff', margin: 0, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto' }}>{viewing.name}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <span style={{ color: '#888', fontSize: 11 }}>{modelScale}%</span>
                <input type="range" min={50} max={200} value={modelScale}
                  onChange={(e) => setModelScale(Number(e.target.value))}
                  style={{ width: 60, accentColor: '#6c63ff' }} />
              </div>
              <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 3, flexShrink: 0 }}>
                <button onClick={() => setViewMode('3d')} style={viewMode === '3d' ? tabActiveStyle : tabStyle}>3D</button>
                {isGlb && <button onClick={() => setViewMode('ar')} style={viewMode === 'ar' ? tabActiveStyle : tabStyle}>AR</button>}
                <button onClick={() => setViewMode('xr')} style={tabStyle}>XR</button>
                <button onClick={() => setViewMode('vr')} style={tabStyle}>VR</button>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ViewerErrorBoundary onReset={() => setViewMode('3d')}>
                {viewMode === '3d' && <ModelViewer modelData={viewing.data} fileName={viewing.fileName} scale={scaleFactor} />}
                {viewMode === 'ar' && <ARViewer modelData={viewing.data} fileName={viewing.fileName} />}
              </ViewerErrorBoundary>
            </div>
          </>
        )}
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
        <button
          onClick={() => setShowScan(true)}
          style={{
            padding: '6px 14px',
            background: '#2d6a4f',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          📷 Room Scan
        </button>
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
            onSave={handleSave}
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

const tabStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  color: '#888',
  border: 'none',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  background: '#6c63ff',
  color: '#fff',
};

// XR mode tabs — bigger for headset use
const xrTab: React.CSSProperties = {
  padding: '10px 18px',
  background: 'transparent',
  color: '#aaa',
  border: 'none',
  borderRadius: 10,
  fontSize: 16,
  fontWeight: 600,
  cursor: 'pointer',
};

const xrTabActive: React.CSSProperties = {
  ...xrTab,
  background: '#6c63ff',
  color: '#fff',
};

