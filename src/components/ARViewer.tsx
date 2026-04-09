import { useEffect, useRef, useState } from 'react';
import '@google/model-viewer';

interface ARViewerProps {
  modelData: ArrayBuffer;
  fileName: string;
  style?: React.CSSProperties;
}

export function ARViewer({ modelData, fileName, style }: ARViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mvRef = useRef<HTMLElement | null>(null);

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isGlb = fileName.toLowerCase().endsWith('.glb') || fileName.toLowerCase().endsWith('.gltf');

  // Create blob URL — never revoke while component is mounted (AR needs it)
  useEffect(() => {
    const ext = fileName.toLowerCase().split('.').pop();
    const mimeType = ext === 'gltf' ? 'model/gltf+json' : 'model/gltf-binary';

    const blob = new Blob([modelData], { type: mimeType });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    blobUrlRef.current = url;

    return () => {
      // Revoke only on unmount, with delay for AR session cleanup
      const urlToRevoke = blobUrlRef.current;
      if (urlToRevoke) {
        setTimeout(() => URL.revokeObjectURL(urlToRevoke), 60000);
      }
    };
  }, [modelData, fileName]);

  // Create model-viewer element imperatively (avoids JSX type issues)
  useEffect(() => {
    if (!blobUrl || !containerRef.current) return;

    // Clear previous
    if (mvRef.current) {
      mvRef.current.remove();
      mvRef.current = null;
    }

    const mv = document.createElement('model-viewer');
    mv.setAttribute('src', blobUrl);
    mv.setAttribute('alt', fileName);
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('touch-action', 'pan-y');
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('shadow-intensity', '1');
    mv.setAttribute('environment-image', 'neutral');
    mv.setAttribute('exposure', '1');
    mv.style.width = '100%';
    mv.style.height = '100%';
    mv.style.setProperty('--poster-color', 'transparent');

    if (isHttps) {
      mv.setAttribute('ar', '');
      // Only use webxr — scene-viewer and quick-look can't access blob URLs
      mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
      mv.setAttribute('ar-scale', 'auto');
      mv.setAttribute('ar-placement', 'floor');
    }

    // Log AR events for debugging
    mv.addEventListener('ar-status', (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.log('[3DQV] AR status:', detail);
    });

    containerRef.current.appendChild(mv);
    mvRef.current = mv;

    return () => {
      if (mvRef.current) {
        mvRef.current.remove();
        mvRef.current = null;
      }
    };
  }, [blobUrl, fileName, isHttps]);

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

  const infoText = isHttps
    ? (isMobile
        ? 'Tippe auf das AR-Icon im Viewer um AR zu starten'
        : 'AR auf dem Handy verfuegbar — hier 3D-Vorschau')
    : 'AR benoetigt HTTPS — nach Deploy verfuegbar. Hier 3D-Vorschau.';

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e', overflow: 'hidden', ...style }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
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
        {infoText}
      </div>
    </div>
  );
}
