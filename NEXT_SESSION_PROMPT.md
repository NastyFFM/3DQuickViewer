# Prompt fuer die naechste Session

Kopiere diesen Text als ersten Prompt in eine neue Claude Code Session:

---

Ich arbeite an **3DQuickViewer** — P2P-Web-App zum Teilen + Betrachten von 3D-Modellen in VR/AR auf Meta Quest. Repo: https://github.com/NastyFFM/3DQuickViewer, Live: https://nastyffm.github.io/3DQuickViewer/

**Sprich Deutsch mit mir.** Lies zuerst `IMPLEMENTATION.md` und **diese Datei vollstaendig**, dann legs los.

## Aktueller Stand v82 — Mocap-Recorder gebaut, abr **akuter Bug**

Die letzten Sessions (v52-v82) haben massive Features dazugebracht — Mocap live, Mocap-Recording mit Audio, Playback, P2P-Transfer. Stand Commit: lokal, **noch nicht gepusht**.

### Der akute Bug (MUSS ZUERST GEFIXT WERDEN)

**Symptom (aus Nutzer-Bericht):** "man kann modelle und animationen nicht mehr laden" — in v82.

**Verdaechtige Ursache:** IndexedDB wurde in `src/lib/storage.ts` auf **Version 4** erhoeht (neuer `mocap-audio` Store). Wenn das Upgrade an einer Stelle kaputtgeht, koennte der gesamte Laden der Galerie silent failen. Der Upgrade-Code sieht korrekt aus (erstellt neue Stores idempotent), aber es gibt keine Pruefung, ob etwa das Laden eines existierenden Eintrags unter einem der neuen Typ-Filter (`type === 'mocap'`) zu einer schlechten Seitennutzerfahrung fuehrt.

**Wahrscheinliche Fehlerquellen:**
1. Modelle/Animationen werden im neuen `useModels`-Hook nicht mehr angezeigt, weil die `models`-Filter durch die Einfuehrung von `type === 'mocap'` subtil geaendert wurde:
   ```ts
   const models = useMemo(() => items.filter((m) => m.type !== 'animation' && m.type !== 'mocap'), [items]);
   ```
   → das SOLLTE korrekt sein (zeigt alles auser animation/mocap), aber pruefen.
2. Das Upload-System koennte durch die Typ-Erweiterung gestoert sein (`guessTypeFromFileName` gibt jetzt auch 'mocap' zurueck? → **Nein**, gibt nur `'animation'` oder `'model'`, also safe).
3. Moeglicherweise wirft die neue `mocapExport.ts` oder `mp3Export.ts` beim Import einen Top-Level-Fehler, der den gesamten Room-Code killt. `mp3Export.ts` importiert `lamejs` — pruefen, ob der Import ueberhaupt laedt.
4. DevTools-Console-Output des Nutzers ist entscheidend — frag ihn nach der exakten Fehlermeldung.

**Diagnose-Schritte zuerst:**
1. User fragen: genaue Konsolen-Fehlermeldung beim Laden eines Modells?
2. Pruefen ob Preview laeuft (`npm run dev` — mit basic-ssl Plugin, https://192.168.0.136:5173/).
3. Lokales Testen mit DevTools → Application → IndexedDB → `3dquickviewer`:
   - Stores vorhanden: `models`, `animations`, `mocap-audio`?
   - `models` Store hat Eintraege?
   - `deleteDatabase('3dquickviewer')` via Console zum Hard-Reset falls DB kaputt.
4. TypeScript-Check sauber (schon bestaetigt), Production-Build auch (bestaetigt). Fehler ist also ein Laufzeitfehler.

### Was fertig ist (v82)

**Mocap-Recorder komplett gebaut nach Plan:**
- `🔴 Aufnehmen` Button in Mocap-Tab → 3s Countdown (rot) → Recording mit Live-Timer-Pill → `⏹ Stop` → Save-Dialog
- Bone-Quats + Mikrofon-Audio werden synchron aufgezeichnet
- Neuer Typ `'mocap'` in StoredModel; Audio separat in IndexedDB Store `mocap-audio`
- Mocap-Aufnahmen erscheinen als neue Galerie-Sektion `🎬🔊 Mocap-Aufnahmen`
- Playback im 3D-View: Mocap-Clips im Animation-Picker mit `🎬🔊 `-Prefix; bei Auswahl laeuft Audio synchron
- MP3-Export on-demand (lamejs wird lazy geladen, 173KB Chunk)
- P2P: `mocap-audio-request/-meta/-chunk/-complete` Messages — empfangendes Geraet pullt Audio nach Model-Complete automatisch
- Version: `v82`

**Alle Kernfeatures v51-v81 intakt:**
- v52-55: FBX als Modelle (type='animation'), IDB v3 Migration, Mocap-UI-Tab, HTTPS basic-ssl fuer Webcam
- v56-60: Animation-Picker im 3D-View, Mixamo-Retargeting (candidateNames mit side-aware Varianten), Bone-Roll-Fix via bindRef+restRef
- v61-73: Mocap live mit MediaPipe Pose, Webcam-Preview resizable (4 Ecken), axis flip + axis permutation UI, Kalibrierung mit Countdown
- v74-81: Bind-Pose-Trennung, Default-Achsen `ZYX` + `X=on Y=off Z=on` fuer Tripo-Rigs, Globales Axis-Swap

### Wichtigste Dateien in dieser Session geaendert / neu

| Datei | Was |
|-------|-----|
| `src/components/MocapView.tsx` | Audio-Stream, Record-UI, Countdown fuer beide Modi, Save-Dialog, Pose-Buffer-Push |
| `src/components/ModelViewer.tsx` | `libraryMocaps` Prop, Mocap → AnimationClip via buildAnimationClip, synchrone Audio-Wiedergabe |
| `src/components/ModelGallery.tsx` | Mocap-Tile-Styling (🎬🔊 Icon, rote Border), MP3-Button |
| `src/hooks/useModels.ts` | Neue `mocaps` derived list, `addMocapRecording`-Funktion, Audio-Loeschen beim Delete |
| `src/lib/storage.ts` | **DB v4**, neuer `mocap-audio` Store, `StoredMocapAudio` Interface, save/get/deleteMocapAudio |
| `src/lib/mocapExport.ts` NEU | JSON-Format `MocapPayload`, `buildAnimationClip`, `parseMocapPayload` |
| `src/lib/mp3Export.ts` NEU | Lazy-Wrapper um lamejs, WebM → MP3 via decodeAudioData |
| `src/lib/peer.ts` | `mocap-audio-*` Messages, `sendMocapAudioToPeer`, `onMocapAudioReceived` Callback, ModelMeta ergaenzt um hasAudio/durationSec |
| `src/pages/Room.tsx` | `libraryMocaps` useMemo, Mocap-Galerie-Sektion, `handleExportMp3` (Dynamic-Import lamejs), `onMocapSaved`-Handler fuer MocapView |
| `src/types/index.ts` | `ItemType += 'mocap'`, `StoredModel.hasAudio/durationSec`, `MocapAudioMeta`/`MocapAudioChunk` |
| `src/hooks/useRoom.ts` | `onMocapAudioReceived` Wire-up (bumpt lastReceived) |
| `package.json` | `lamejs` Dependency |
| `src/version.ts` | v82 |

**Build + TypeScript: clean.** Aber der Nutzer berichtet Laufzeitfehler — **also noch nicht pushen**. Erst Bug finden, fixen, dann commit + push.

### Arbeitsplan-Datei

Der detaillierte Schritt-fuer-Schritt Plan fuer den Recorder liegt in `/Users/chris.pohl/.claude/plans/was-sind-die-n-chsten-peaceful-crown.md` — kann als Referenz fuer die 11 Schritte herangezogen werden.

### Noch nicht umgesetzt (nach Bug-Fix vorsehen)

1. **XR/VR Mocap-Playback** — aktuell laeuft Mocap-Wiedergabe nur im **3D-View**. Fuer Quest/XR-Replay muesste `libraryMocaps` analog in `XRViewer.tsx` und `VRScene.tsx` integriert werden (gleiche Logik wie ModelViewer: parseMocapPayload → buildAnimationClip → clip-Prefix → sync Audio). Schrittweise angehen.

2. **Mocap-Aufnahme in Quest** — aktuell kann man auf Quest nicht aufnehmen (Webcam-Permission + MediaPipe laden, aber Quest Browser ist manchmal heikel). Testen + ggf. MIME-Fallbacks fuer Audio erweitern.

3. **Existing GLTFExporter-Alternative** — Mocap-Format ist aktuell eigenes JSON, kein GLB. Vorteil: einfach. Nachteil: nicht mit anderer 3D-Software nutzbar. Falls spaeter Export in Blender/Maya gewuenscht, Refactor zu GLTFExporter (Risiken im Plan dokumentiert).

4. **P2P-Transfer-Reliability >12MB** — alte offene Baustelle, Backpressure-Drain in `peer.ts` koennte bei groossen Mocap+Audio-Bundles reissen. Noch nicht akut, aber im Auge behalten.

5. **Recorder-Verbesserungen** (Nutzer-Anforderungen koennten kommen):
   - Trimmen (Start/Ende abschneiden nach Aufnahme)
   - Mocap umbenennen nach dem Speichern
   - Playback-Geschwindigkeit / Scrubbing
   - Loop-Steuerung pro Mocap-Clip

### Deploy-Status

- GitHub Pages Auto-Deploy bei Push auf `main` via Actions.
- **v82 nicht gepusht** (wegen Bug). Letzter deployter Stand ist v81.
- HTTPS lokal via `@vitejs/plugin-basic-ssl` (fuer Webcam auf LAN-Geraeten).

### Workflow-Regeln fuer dich

- Default-Werte fuer Tripo-Rigs: `axisPerm='ZYX'`, `axisFlip={x:true, y:false, z:true}`.
- Der Preview-Browser in dieser Umgebung akzeptiert das Self-Signed Cert NICHT — Verify ist nur per `npx tsc --noEmit -p tsconfig.app.json` + `npx vite build` moeglich. Nutzer testet im echten Browser.
- Nichts pushen ohne User-Bestaetigung.
- **Deutsch sprechen.**

---

Bitte:
1. IMPLEMENTATION.md und diese NEXT_SESSION_PROMPT.md lesen
2. User nach dem genauen Console-Fehler fragen beim Laden von Modellen/Animationen
3. Den Fehler systematisch debuggen
4. Fixen, testen, committen + pushen
5. Dann mit der Roadmap weitermachen

---
