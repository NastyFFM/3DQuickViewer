# 3DQuickViewer — Implementierungsdokumentation

## Ueberblick

P2P 3D-Modell-Viewer: Desktop-Browser laedt Modelle hoch, Quest/Handy betrachtet sie in VR/AR. Kein Server-Upload noetig — Modelle werden direkt via WebRTC zwischen Geraeten uebertragen.

**Live:** https://nastyffm.github.io/3DQuickViewer/
**Repo:** https://github.com/NastyFFM/3DQuickViewer

---

## Architektur

```
┌─────────────────────────────────────────────────────┐
│  GitHub Pages (Static Hosting, HTTPS)               │
│  React SPA + Three.js + model-viewer                │
└──────────────┬──────────────────────┬───────────────┘
               │ Socket.IO            │ WebRTC DataChannel
               ▼                      ▼
┌──────────────────────┐   ┌──────────────────────────┐
│  Railway Signaling    │   │  Peer-to-Peer Transfer   │
│  Server (WebSocket)   │   │  64KB Chunks, Base64     │
│  Raum-Verwaltung      │   │  Modelle direkt ueber-   │
│  SDP/ICE Exchange     │   │  tragen, kein Upload     │
└──────────────────────┘   └──────────────────────────┘
```

## Tech Stack

| Bereich | Technologie |
|---------|-------------|
| Framework | React 19 + TypeScript + Vite 5 |
| 3D Rendering | Three.js + @react-three/fiber + drei |
| VR | @react-three/xr (WebXR immersive-vr) |
| AR | @google/model-viewer (WebXR/SceneViewer/QuickLook) |
| P2P | Socket.IO Client + native RTCPeerConnection + RTCDataChannel |
| Signaling | Railway (web-production-84380f.up.railway.app) |
| Speicher | IndexedDB (idb) fuer Modelle, localStorage fuer Raum-IDs |
| QR-Code | qrcode.react |
| Deploy | GitHub Pages (Actions Workflow) |

## Dateistruktur

```
src/
├── components/
│   ├── ARViewer.tsx            # Google model-viewer (AR auf HTTPS)
│   ├── DropZone.tsx            # Drag & Drop Upload (GLB/GLTF/OBJ/STL, max 100MB)
│   ├── ModelGallery.tsx        # Modell-Grid mit Aktionen (Ansehen/Speichern/Senden/Loeschen)
│   ├── ModelViewer.tsx         # Three.js 3D-Viewer mit OrbitControls
│   ├── VRScene.tsx             # WebXR VR-Szene (Quest)
│   └── ViewerErrorBoundary.tsx # Fehler-Auffang fuer Viewer-Crashes
├── hooks/
│   ├── useModels.ts            # IndexedDB CRUD fuer Modelle
│   └── useRoom.ts              # WebRTC Verbindungs-State
├── lib/
│   ├── peer.ts                 # RoomPeer Klasse (Socket.IO + WebRTC)
│   ├── storage.ts              # IndexedDB + localStorage Zugriff
│   └── idb.ts                  # Re-Export von idb
├── pages/
│   ├── Home.tsx                # Startseite (Raum erstellen/beitreten)
│   └── Room.tsx                # Hauptseite (Upload, QR, Galerie, Viewer)
├── types/
│   └── index.ts                # TypeScript Interfaces
├── App.tsx                     # Router (/, /room/:roomId)
├── main.tsx                    # Einstiegspunkt
└── index.css                   # Globale Styles
```

## User Flow

1. **Desktop** oeffnet Webseite → "Raum erstellen" → erhaelt 6-stelligen Code + QR
2. **Quest/Handy** scannt QR oder gibt Code ein → verbindet via Socket.IO → WebRTC DataChannel
3. **Desktop** zieht GLB-Datei in DropZone → gespeichert in IndexedDB → Modell-Liste an Peer gesendet
4. **Quest/Handy** sieht Remote-Modell → "Laden" klickt → 64KB Chunks via WebRTC empfangen → in IndexedDB gespeichert
5. **Quest/Handy** "Ansehen" → waehlt 3D / AR / VR Tab

## Signaling Protokoll

Der Railway-Server ist ein Socket.IO Server mit folgenden Events:

| Event | Richtung | Payload |
|-------|----------|---------|
| `join-room` | Client → Server | `{ roomId, maxUsers? }` |
| `room-users` | Server → Client | `{ roomId, users[] }` |
| `user-joined` | Server → Clients | `{ userId }` |
| `user-left` | Server → Clients | `{ userId }` |
| `offer` | Client → Server → Client | `{ roomId, offer, targetId }` |
| `answer` | Client → Server → Client | `{ roomId, answer, targetId }` |
| `ice-candidate` | Client → Server → Client | `{ roomId, candidate, targetId }` |

## Model Transfer Protokoll (ueber RTCDataChannel)

| Nachricht | Payload | Beschreibung |
|-----------|---------|--------------|
| `model-list` | `ModelMeta[]` | Liste aller lokalen Modelle (bei Connect gesendet) |
| `model-request` | `modelId` | Modell-Download anfragen |
| `model-meta` | `ModelMeta` | Metadaten vor Transfer senden |
| `model-chunk` | `{ modelId, chunkIndex, totalChunks, data }` | 64KB Base64-Chunk |
| `model-complete` | `modelId` | Transfer abgeschlossen |

---

## Was funktioniert

- [x] Raum erstellen und beitreten (6-stelliger Code)
- [x] QR-Code zum Verbinden (mit korrektem Base-Path)
- [x] WebRTC P2P-Verbindung ueber Socket.IO Signaling
- [x] Drag & Drop Upload (GLB, GLTF, OBJ, STL)
- [x] Chunked Model Transfer via DataChannel
- [x] IndexedDB lokale Modell-Galerie
- [x] 3D-Viewer (Three.js mit OrbitControls)
- [x] VR-Modus (WebXR auf Quest)
- [x] AR-Viewer (model-viewer, 3D-Vorschau funktioniert)
- [x] Datei speichern/downloaden
- [x] Modelle loeschen
- [x] Modelle an verbundene Peers senden
- [x] Persistente Raeume (localStorage)
- [x] GitHub Pages Deployment (HTTPS, SPA Routing)
- [x] Error Boundary fuer Viewer-Crashes

---

## Offene Punkte / Known Issues

### Hoch (Funktional)

1. **AR Platzierung funktioniert nicht**
   - Kamera startet, aber Objekt wird nicht platziert
   - Vermutung: Blob-URLs funktionieren nicht mit Scene Viewer (Android) / Quick Look (iOS)
   - Nur WebXR AR kann Blob-URLs nutzen, aber nicht alle Handys unterstuetzen WebXR AR
   - **Loesung:** Modell temporaer auf einen Server hochladen (z.B. als Base64 in einem kurzzeitigen Endpoint) oder einen Service Worker als lokalen File-Server nutzen

2. **Modell-Empfang: UI aktualisiert nicht immer sofort**
   - Nach Transfer-Abschluss wird `refresh()` ueber Transfer-Count-Change getriggert
   - Manchmal verzoegert sich die Anzeige um bis zu 2 Sekunden (Polling-Intervall)
   - **Loesung:** Event-basiertes Refresh statt Polling

### Mittel (UX)

3. **Kein Thumbnail/Preview in der Galerie**
   - Modell-Karten zeigen nur Name + Groesse, kein Vorschaubild
   - **Loesung:** Beim Upload einen Canvas-Screenshot des Modells erstellen und als Thumbnail speichern

4. **Keine Fortschrittsanzeige beim Upload**
   - Grosse Dateien (>10MB) laden ohne Feedback
   - **Loesung:** Upload-Progress-Bar in der DropZone

5. **Host-Logik ist simpel**
   - Jeder Browser-Tab markiert sich als Host
   - **Loesung:** Server-seitig den ersten User als Host markieren

6. **Duplikate moeglich**
   - Gleiches Modell mehrfach hochladen erzeugt separate Eintraege
   - **Loesung:** Hash-basierte Deduplizierung

### Niedrig (Optimierung)

7. **Base64-Encoding vergroessert Transfer um ~33%**
   - 64KB Chunks werden als Base64 gesendet
   - **Loesung:** ArrayBuffer direkt ueber DataChannel senden (binary mode)

8. **Three.js "Multiple instances" Warning**
   - model-viewer bringt eigene Three.js Version mit
   - Kein funktionelles Problem, aber Build-Groesse steigt
   - **Loesung:** model-viewer per CDN laden statt npm

9. **Alte Assets in public/**
   - `hero.png`, `react.svg`, `vite.svg` sind vom Vite-Template uebrig
   - **Loesung:** Aufraumen

10. **Kein Offline-Support**
    - Service Worker fuer PWA wuerde Offline-Galerie ermoeglichen
    - **Loesung:** vite-plugin-pwa

---

## Deployment

### GitHub Pages (aktuell)
- Push auf `main` → GitHub Actions baut → deployed auf `nastyffm.github.io/3DQuickViewer/`
- HTTPS automatisch (wichtig fuer WebXR/AR)
- SPA-Routing via `404.html` Redirect

### Vercel (alternativ)
- `vercel.json` mit SPA-Rewrites vorhanden
- Kein Base-Path noetig (Root-Domain)
- Einfach Repo verbinden

### Lokal
- `npm run dev` → `http://localhost:5173`
- `--host` fuer LAN-Zugriff (Quest im gleichen WiFi)
