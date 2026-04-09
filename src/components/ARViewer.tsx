import { useEffect, useState } from 'react';
import '@google/model-viewer';

interface ARViewerProps {
  modelData: ArrayBuffer;
  fileName: string;
  style?: React.CSSProperties;
}

export function ARViewer({ modelData, fileName, style }: ARViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  useEffect(() => {
    const ext = fileName.toLowerCase().split('.').pop();
    let mimeType = 'model/gltf-binary';
    if (ext === 'gltf') mimeType = 'model/gltf+json';

    const blob = new Blob([modelData], { type: mimeType });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);

    const urlToRevoke = url;
    return () => {
      setTimeout(() => URL.revokeObjectURL(urlToRevoke), 10000);
    };
  }, [modelData, fileName]);

  const isGlb = fileName.toLowerCase().endsWith('.glb') || fileName.toLowerCase().endsWith('.gltf');

  if (!isGlb) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        background: '#1a1a2e',
        color: '#888',
        padding: 24,
        textAlign: 'center',
        ...style,
      }}>
        AR-Ansicht nur fuer GLB/GLTF Dateien verfuegbar.
      </div>
    );
  }

  if (!blobUrl) return null;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e', overflow: 'hidden', ...style }}>
      <model-viewer
        src={blobUrl}
        alt={fileName}
        // Only enable AR on HTTPS — WebXR/SceneViewer/QuickLook all require secure context
        {...(isHttps ? { ar: true, 'ar-modes': 'webxr scene-viewer quick-look' } : {})}
        camera-controls={true}
        touch-action="pan-y"
        auto-rotate={true}
        shadow-intensity="1"
        environment-image="neutral"
        exposure="1"
        style={{
          width: '100%',
          height: '100%',
          '--poster-color': 'transparent',
        } as React.CSSProperties}
      />

      {/* Info banner */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.7)',
        borderRadius: 8,
        padding: '8px 16px',
        fontSize: 13,
        color: '#aaa',
        textAlign: 'center',
        maxWidth: '90%',
        pointerEvents: 'none',
      }}>
        {isHttps
          ? (isMobile
              ? 'Tippe auf das AR-Icon im Viewer um AR zu starten'
              : 'AR auf dem Handy verfuegbar — hier 3D-Vorschau')
          : 'AR benoetigt HTTPS — nach Vercel-Deploy verfuegbar. Hier 3D-Vorschau.'}
      </div>
    </div>
  );
}
