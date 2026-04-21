# Prompt fuer die naechste Session

Kopiere diesen Text als ersten Prompt in eine neue Claude Code Session:

---

Ich arbeite an **3DQuickViewer** — einer P2P Web-App zum Teilen und Betrachten von 3D-Modellen in VR/AR auf Meta Quest. Repo: https://github.com/NastyFFM/3DQuickViewer, Live: https://nastyffm.github.io/3DQuickViewer/

## Aktueller Stand (v51)
- React + Three.js + Vite, deployed auf GitHub Pages (HTTPS)
- WebRTC P2P Transfer via Socket.IO Signaling (Railway)
- 3D-Viewer, XR (AR mit Grab), VR (mit Grab), AR (model-viewer)
- Room Scan mit Hit-Test Grid
- IndexedDB Galerie, Drag&Drop Upload, QR-Code Sharing
- Occlusion Culling + Haende Toggle
- Animation Library (FBX Upload, Mixamo Support)
- Scale Slider (Echtzeit)
- XR Galerie-Kacheln zum Modell-Wechsel ohne XR zu verlassen
- Lies `IMPLEMENTATION.md` fuer volle Doku

## WICHTIGSTE AUFGABE: FBX Animationen wie Modelle behandeln

Aktuell werden FBX-Animationen separat in einem eigenen IndexedDB Store gespeichert und nur als kleine Chips angezeigt. Der User will:

1. **FBX-Animationen in der gleichen Galerie wie Modelle** — eigene Kacheln mit Ansehen/Speichern/Loeschen/Senden Buttons
2. **P2P Transfer fuer Animationen** — genau wie Modelle per WebRTC von Geraet zu Geraet senden
3. **Animationen auf Modelle anwenden** — in der XR-Ansicht soll man eine Animation auswaehlen und auf das aktuelle Modell anwenden koennen

Ansatz:
- Animationen als eigenen Typ in der ModelGallery anzeigen (mit 🎬 Icon statt 🧊)
- P2P Transfer erweitern: neue Message-Types `animation-list`, `animation-request`, `animation-chunk`, etc.
- Oder einfacher: Animationen als StoredModel mit einem `type: 'animation'` Flag speichern und das existierende Transfer-System nutzen

## Weitere offene Punkte
- Dateitransfer bricht bei >12MB ab (Backpressure funktioniert nicht zuverlaessig)
- Version-Nummer v51 unten rechts anzeigen (bereits implementiert)
- IMPLEMENTATION.md und NEXT_SESSION_PROMPT.md aktualisieren

Starte mit dem FBX-als-Modell-behandeln Feature.

---
