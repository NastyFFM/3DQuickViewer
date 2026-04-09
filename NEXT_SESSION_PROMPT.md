# Prompt fuer die naechste Session

Kopiere diesen Text als ersten Prompt in eine neue Claude Code Session:

---

Ich arbeite an **3DQuickViewer** — einer P2P Web-App zum Teilen und Betrachten von 3D-Modellen in VR/AR. Repo: https://github.com/NastyFFM/3DQuickViewer, Live: https://nastyffm.github.io/3DQuickViewer/

## Aktueller Stand
- React + Three.js + Vite App, deployed auf GitHub Pages (HTTPS)
- WebRTC P2P Transfer via Socket.IO Signaling Server (Railway: web-production-84380f.up.railway.app)
- 3D-Viewer (Three.js), VR (WebXR/Quest), AR (Google model-viewer) — 3D und VR funktionieren
- IndexedDB lokale Galerie, Drag&Drop Upload, QR-Code Sharing, persistente Raeume
- Lies `IMPLEMENTATION.md` fuer die volle Doku

## Wichtigstes offenes Problem: AR funktioniert nicht
Die AR-Ansicht (model-viewer) startet die Kamera auf dem Handy, aber das 3D-Objekt wird nicht platziert. Das Problem: Blob-URLs (aus IndexedDB geladene Modelle) funktionieren nicht mit Scene Viewer (Android) und Quick Look (iOS). Nur WebXR AR kann Blob-URLs nutzen, aber viele Handys unterstuetzen das nicht.

Moegliche Loesungen:
1. **Service Worker als lokaler File-Server** — registriere einen SW der Blob-URLs unter einer echten URL bereitstellt (z.B. `/ar-model/model.glb`)
2. **Temporaerer Upload** — Modell kurzzeitig auf einen Server laden und die URL an model-viewer geben
3. **WebXR-only AR** — nur `ar-modes="webxr"` nutzen (funktioniert mit Blob-URLs, aber weniger Geraete unterstuetzt)

## Weitere offene Punkte
- Thumbnails/Previews in der Modell-Galerie
- Upload-Fortschrittsbalken
- Binary Transfer statt Base64 (33% effizienter)
- Alte Template-Assets aufraemen (hero.png, react.svg, vite.svg)
- Event-basiertes UI-Refresh statt 2s-Polling nach Model-Empfang

Starte mit dem AR-Fix (Service Worker Ansatz ist vermutlich der beste) und arbeite dann die weiteren Punkte ab.

---
