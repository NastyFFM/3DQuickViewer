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
import { useAnimationLibrary } from '../hooks/useAnimationLibrary';
import type { StoredModel } from '../types';

export function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { models, addModelFromFile, deleteModelById, refresh } = useModels();
  const { animations: libraryAnims, addAnimationFromFile, deleteAnimationById } = useAnimationLibrary();
  const [viewing, setViewing] = useState<StoredModel | null>(null);
  const [viewMode, setViewMode] = useState<'3d' | 'ar' | 'xr' | 'vr'>('3d');
  const [modelScale, setModelScale] = useState(100);
  const [occlusionEnabled, setOcclusionEnabled] = useState(true);
  const [handsEnabled, setHandsEnabled] = useState(true);
  // Animation state
  const [animationNames, setAnimationNames] = useState<string[]>([]);
  const [activeAnimation, setActiveAnimation] = useState<string | null>(null);
  const [animationLoop, setAnimationLoop] = useState(true);
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
              <button
                onClick={() => setOcclusionEnabled(!occlusionEnabled)}
                style={{
                  background: occlusionEnabled ? '#4caf50' : '#555',
                  color: '#fff', border: 'none', borderRadius: 8,
                  padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                  fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >
                {occlusionEnabled ? '🫣 Occ' : '👁 Occ'}
              </button>
              <button
                onClick={() => setHandsEnabled(!handsEnabled)}
                style={{
                  background: handsEnabled ? '#4caf50' : '#555',
                  color: '#fff', border: 'none', borderRadius: 8,
                  padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                  fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >
                {handsEnabled ? '🤚 Hands' : '🚫 Hands'}
              </button>
            </div>

            {/* Canvas hidden but stays in DOM so XR session keeps running */}
            <div style={{ height: 1, overflow: 'hidden', opacity: 0 }}>
              <ViewerErrorBoundary onReset={() => setViewMode('3d')}>
                {viewMode === 'xr' && <XRViewer modelData={viewing.data} fileName={viewing.fileName} scale={scaleFactor} autoEnter activeAnimation={activeAnimation} animationLoop={animationLoop} onAnimationsFound={(names) => { setAnimationNames(names); if (names.length > 0 && !activeAnimation) setActiveAnimation(names[0]); }} depthOcclusion={occlusionEnabled} showHands={handsEnabled} libraryAnimations={libraryAnims.map(a => ({ data: a.data, fileName: a.fileName }))} />}
                {viewMode === 'vr' && <VRScene modelData={viewing.data} fileName={viewing.fileName} scale={scaleFactor} activeAnimation={activeAnimation} animationLoop={animationLoop} onAnimationsFound={(names) => { setAnimationNames(names); if (names.length > 0 && !activeAnimation) setActiveAnimation(names[0]); }} depthOcclusion={occlusionEnabled} showHands={handsEnabled} libraryAnimations={libraryAnims.map(a => ({ data: a.data, fileName: a.fileName }))} />}
              </ViewerErrorBoundary>
            </div>

            {/* Full-screen model gallery */}
            <div style={{ flex: 1, overflow: 'auto', padding: 16, background: '#0d0d1a' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 12,
              }}>
                {models.map((m) => {
                  const isActive = m.id === viewing.id;
                  return (
                    <div
                      key={m.id}
                      style={{
                        background: isActive ? '#6c63ff' : 'rgba(255,255,255,0.08)',
                        color: '#fff',
                        border: isActive ? '2px solid #9c8fff' : '2px solid #333',
                        borderRadius: 16,
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {/* Model info — clickable to select */}
                      <div
                        onClick={() => { setViewing(m); setAnimationNames([]); setActiveAnimation(null); }}
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                      >
                        <span style={{ fontSize: 28 }}>🧊</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: isActive ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.name}
                          </div>
                          <div style={{ fontSize: 12, color: isActive ? '#c8c0ff' : '#666' }}>
                            {(m.fileSize / (1024 * 1024)).toFixed(1)} MB
                          </div>
                        </div>
                      </div>

                      {/* Animation controls — only on active model */}
                      {isActive && animationNames.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 8 }}>
                          {/* Loop toggle */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                              onClick={() => setAnimationLoop(!animationLoop)}
                              style={{
                                background: animationLoop ? '#4caf50' : '#555',
                                color: '#fff', border: 'none', borderRadius: 6,
                                padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                              }}
                            >
                              {animationLoop ? '🔁 Loop' : '▶️ Einmal'}
                            </button>
                            <button
                              onClick={() => setActiveAnimation(null)}
                              style={{
                                background: '#d32f2f', color: '#fff', border: 'none',
                                borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                              }}
                            >
                              ⏹ Stop
                            </button>
                          </div>
                          {/* Animation list */}
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {animationNames.map((name) => (
                              <button
                                key={name}
                                onClick={() => setActiveAnimation(name)}
                                style={{
                                  background: activeAnimation === name ? '#fff' : 'rgba(255,255,255,0.15)',
                                  color: activeAnimation === name ? '#333' : '#fff',
                                  border: 'none', borderRadius: 6,
                                  padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                                  fontWeight: activeAnimation === name ? 700 : 400,
                                }}
                              >
                                ▶ {name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Animation Library */}
              <div style={{ marginTop: 20, borderTop: '1px solid #333', paddingTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <h3 style={{ color: '#888', margin: 0, fontSize: 14 }}>🎬 Animation Library</h3>
                  <label style={{
                    background: '#6c63ff', color: '#fff', border: 'none', borderRadius: 8,
                    padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
                  }}>
                    + Upload
                    <input type="file" accept=".glb,.gltf,.fbx" style={{ display: 'none' }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) await addAnimationFromFile(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                {libraryAnims.length === 0 ? (
                  <div style={{ color: '#555', fontSize: 13 }}>
                    Lade GLB-Dateien mit Animationen hoch (z.B. von Mixamo)
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {libraryAnims.map((a) => (
                      <div key={a.id} style={{
                        background: 'rgba(255,255,255,0.08)', borderRadius: 10,
                        padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                        <span style={{ fontSize: 14 }}>🎬 {a.name}</span>
                        <span style={{ color: '#666', fontSize: 11 }}>{(a.fileSize / 1024).toFixed(0)}KB</span>
                        <button onClick={() => deleteAnimationById(a.id)} style={{
                          background: '#d32f2f', color: '#fff', border: 'none', borderRadius: 4,
                          padding: '2px 6px', fontSize: 11, cursor: 'pointer',
                        }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
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
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <ViewerErrorBoundary onReset={() => setViewMode('3d')}>
                {viewMode === '3d' && <ModelViewer modelData={viewing.data} fileName={viewing.fileName} scale={scaleFactor} />}
                {viewMode === 'ar' && <ARViewer modelData={viewing.data} fileName={viewing.fileName} />}
              </ViewerErrorBoundary>
              {/* Big XR button overlaid on the 3D viewer */}
              <button
                onClick={() => setViewMode('xr')}
                style={{
                  position: 'absolute',
                  bottom: 24,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#6c63ff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 14,
                  padding: '16px 36px',
                  fontSize: 20,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 24px rgba(108,99,255,0.4)',
                  zIndex: 5,
                }}
              >
                🥽 In XR ansehen
              </button>
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


