import { useState, useCallback, useRef } from 'react';

const ALL_EXTENSIONS = ['.glb', '.gltf', '.obj', '.stl', '.fbx', '.json'];

/** True when a filename is recognisable as one of our supported formats.
 * Mocap JSON is any `.json` that contains `.mocap` somewhere in the name —
 * this catches browser-download duplicates like `foo.mocap (1).json` and
 * renamed-but-still-tagged variants. Other `.json` files are rejected. */
function isAccepted(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return lower.includes('.mocap');
  const ext = '.' + lower.split('.').pop();
  return ALL_EXTENSIONS.includes(ext);
}

interface DropZoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function DropZone({ onFile, disabled }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndEmit = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const invalid: string[] = [];
    const oversized: string[] = [];
    const valid: File[] = [];
    for (const f of arr) {
      if (!isAccepted(f.name)) {
        invalid.push(f.name);
        continue;
      }
      if (f.size > 100 * 1024 * 1024) {
        oversized.push(f.name);
        continue;
      }
      valid.push(f);
    }
    const errs: string[] = [];
    if (invalid.length) errs.push(`Format nicht unterstuetzt: ${invalid.join(', ')}`);
    if (oversized.length) errs.push(`Zu gross (max. 100MB): ${oversized.join(', ')}`);
    setError(errs.length ? errs.join(' — ') : null);
    for (const f of valid) onFile(f);
  }, [onFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) validateAndEmit(e.dataTransfer.files);
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
          if (e.target.files && e.target.files.length > 0) validateAndEmit(e.target.files);
          e.target.value = '';
        }}
      />
      <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 8 }}>
        Modell, Animation oder Mocap hierher ziehen
      </div>
      <div style={{ fontSize: 14, color: '#888' }}>
        oder klicken zum Auswaehlen
      </div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
        GLB, GLTF, OBJ, STL — Modelle · FBX — Animationen · .mocap.json — Mocap · max. 100MB
      </div>
      {error && (
        <div style={{ color: '#ff4444', marginTop: 12, fontSize: 14 }}>{error}</div>
      )}
    </div>
  );
}
