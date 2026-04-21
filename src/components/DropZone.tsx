import { useState, useCallback, useRef } from 'react';

const MODEL_EXTENSIONS = ['.glb', '.gltf', '.obj', '.stl'];
const ANIM_EXTENSIONS = ['.fbx'];
const ALL_EXTENSIONS = [...MODEL_EXTENSIONS, ...ANIM_EXTENSIONS];

interface DropZoneProps {
  onFile: (file: File) => void;
  onAnimationFile?: (file: File) => void;
  disabled?: boolean;
}

export function DropZone({ onFile, onAnimationFile, disabled }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndEmit = useCallback((file: File) => {
    const ext = '.' + file.name.toLowerCase().split('.').pop();
    if (!ALL_EXTENSIONS.includes(ext)) {
      setError(`Format nicht unterstuetzt. Erlaubt: ${ALL_EXTENSIONS.join(', ')}`);
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('Datei zu gross (max. 100MB)');
      return;
    }
    setError(null);

    if (ANIM_EXTENSIONS.includes(ext)) {
      onAnimationFile?.(file);
    } else {
      onFile(file);
    }
  }, [onFile, onAnimationFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    // Handle multiple files
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      validateAndEmit(e.dataTransfer.files[i]);
    }
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
        accept={ALL_EXTENSIONS.join(',')}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) {
            for (let i = 0; i < e.target.files.length; i++) {
              validateAndEmit(e.target.files[i]);
            }
          }
          e.target.value = '';
        }}
      />
      <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 8 }}>
        Dateien hierher ziehen
      </div>
      <div style={{ fontSize: 14, color: '#888' }}>
        oder klicken zum Auswaehlen
      </div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
        Modelle: GLB, GLTF, OBJ, STL — Animationen: FBX
      </div>
      {error && (
        <div style={{ color: '#ff4444', marginTop: 12, fontSize: 14 }}>{error}</div>
      )}
    </div>
  );
}
