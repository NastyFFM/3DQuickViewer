import { useState, useCallback, useRef } from 'react';

const ACCEPTED_EXTENSIONS = ['.glb', '.gltf', '.obj', '.stl'];

interface DropZoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function DropZone({ onFile, disabled }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndEmit = useCallback((file: File) => {
    const ext = '.' + file.name.toLowerCase().split('.').pop();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError(`Format nicht unterstuetzt. Erlaubt: ${ACCEPTED_EXTENSIONS.join(', ')}`);
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('Datei zu gross (max. 100MB)');
      return;
    }
    setError(null);
    onFile(file);
  }, [onFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) validateAndEmit(file);
  }, [disabled, validateAndEmit]);

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${dragging ? '#6c63ff' : '#444'}`,
        borderRadius: 16,
        padding: '48px 24px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: dragging ? 'rgba(108, 99, 255, 0.08)' : 'rgba(255,255,255,0.03)',
        transition: 'all 0.2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) validateAndEmit(file);
          e.target.value = '';
        }}
      />
      <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 8 }}>
        3D-Modell hierher ziehen
      </div>
      <div style={{ fontSize: 14, color: '#888' }}>
        oder klicken zum Auswaehlen
      </div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
        GLB, GLTF, OBJ, STL — max. 100MB
      </div>
      {error && (
        <div style={{ color: '#ff4444', marginTop: 12, fontSize: 14 }}>{error}</div>
      )}
    </div>
  );
}
