import type { StoredModel, ModelMeta, TransferProgress, ItemType } from '../types';

interface ModelGalleryProps {
  localModels: StoredModel[];
  remoteModels?: ModelMeta[];
  transfers?: TransferProgress[];
  onView: (model: StoredModel) => void;
  onDelete: (id: string) => void;
  onSave?: (model: StoredModel) => void;
  onSend?: (id: string) => void;
  onDownload?: (id: string) => void;
  showSend?: boolean;
  showDownload?: boolean;
  emptyLabel?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function iconFor(type: ItemType | undefined): string {
  return type === 'animation' ? '🎬' : '🧊';
}

function ModelCard({
  name,
  fileName,
  fileSize,
  type,
  isLocal,
  isTransferring,
  progress,
  onView,
  onDelete,
  onSave,
  onSend,
  onDownload,
  showSend,
  showDownload,
}: {
  name: string;
  fileName: string;
  fileSize: number;
  type: ItemType | undefined;
  isLocal: boolean;
  isTransferring?: boolean;
  progress?: number;
  onView?: () => void;
  onDelete?: () => void;
  onSave?: () => void;
  onSend?: () => void;
  onDownload?: () => void;
  showSend?: boolean;
  showDownload?: boolean;
}) {
  const isAnimation = type === 'animation';
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        border: isAnimation ? '1px solid rgba(233, 180, 99, 0.3)' : '1px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 24 }}>{iconFor(type)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {formatSize(fileSize)} — {isAnimation ? 'Animation' : fileName.split('.').pop()?.toUpperCase()}
          </div>
        </div>
      </div>

      {isTransferring && (
        <div style={{ background: '#333', borderRadius: 4, overflow: 'hidden', height: 6 }}>
          <div
            style={{
              background: '#6c63ff',
              height: '100%',
              width: `${(progress ?? 0) * 100}%`,
              transition: 'width 0.3s',
            }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
        {isLocal && !isAnimation && onView && (
          <button onClick={onView} style={btnStyle}>Ansehen</button>
        )}
        {isLocal && onSave && (
          <button onClick={onSave} style={{ ...btnStyle, background: '#1565c0' }}>Speichern</button>
        )}
        {!isLocal && showDownload && onDownload && (
          <button onClick={onDownload} style={btnStyle}>Laden</button>
        )}
        {isLocal && showSend && onSend && (
          <button onClick={onSend} style={{ ...btnStyle, background: '#2d6a4f' }}>Senden</button>
        )}
        {isLocal && onDelete && (
          <button onClick={onDelete} style={{ ...btnStyle, background: '#d32f2f' }}>Loeschen</button>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#6c63ff',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
};

export function ModelGallery({
  localModels,
  remoteModels = [],
  transfers = [],
  onView,
  onDelete,
  onSave,
  onSend,
  onDownload,
  showSend,
  showDownload,
  emptyLabel = 'Noch keine Modelle vorhanden',
}: ModelGalleryProps) {
  const localIds = new Set(localModels.map((m) => m.id));
  const remoteOnly = remoteModels.filter((m) => !localIds.has(m.id));

  if (localModels.length === 0 && remoteOnly.length === 0) {
    return (
      <div style={{ color: '#666', textAlign: 'center', padding: 24 }}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
      {localModels.map((model) => {
        const transfer = transfers.find((t) => t.modelId === model.id);
        return (
          <ModelCard
            key={model.id}
            name={model.name}
            fileName={model.fileName}
            fileSize={model.fileSize}
            type={model.type}
            isLocal
            isTransferring={!!transfer}
            progress={transfer?.progress}
            onView={() => onView(model)}
            onDelete={() => onDelete(model.id)}
            onSave={onSave ? () => onSave(model) : undefined}
            onSend={onSend ? () => onSend(model.id) : undefined}
            showSend={showSend}
          />
        );
      })}
      {remoteOnly.map((meta) => {
        const transfer = transfers.find((t) => t.modelId === meta.id);
        return (
          <ModelCard
            key={`remote-${meta.id}`}
            name={meta.name}
            fileName={meta.fileName}
            fileSize={meta.fileSize}
            type={meta.type}
            isLocal={false}
            isTransferring={!!transfer}
            progress={transfer?.progress}
            onDownload={onDownload ? () => onDownload(meta.id) : undefined}
            showDownload={showDownload}
          />
        );
      })}
    </div>
  );
}
