# CLAY HANDS — Hands-First VR & Mixed Reality Pottery Studio

**CLAY HANDS** is a 100% client-side, zero-API-key **WebXR pottery and 3D clay-crafting studio** built with **TypeScript**, **Three.js**, **XR Blocks (`xrblocks`)**, **MediaPipe Tasks Vision**, and procedural **Web Audio API** sound design.

Shape spinning radial clay vessels or sculpt **3D Clay Name plaques** using bare hands in **Meta Quest VR (`immersive-vr`)**, **Meta Quest 3 Mixed Reality Passthrough (`immersive-ar`)**, **Desktop Webcam Hand Tracking**, or **Mouse & Keyboard**—then paint folk motifs, preview realistic PBR ceramic glazes, fire your creation in a magical brick kiln, export `.glb` 3D models, smash ceramics with a wooden bat, and restore shards with **Chrono Rewind**.

---

## Key Features

- **Hands-First WebXR & MR Passthrough (`immersive-vr` / `immersive-ar`):**
  - Full 25-joint WebXR hand tracking mapped to real-time cylindrical clay gestures (*Compress, Widen, Raise Walls, Pinch Neck/Interior, Smooth, One-Side*), index-thumb pinch brush painting, and 3D spatial UI interaction.
  - **MR: Real Desk Mode (`immersive-ar`):** Automatically hides studio walls, floor, kiln props, and the pottery wheel's tripod floor legs so a sleek **tabletop pottery wheel** rests directly on your physical desk. Switch cleanly between **Real Desk (MR)** and **Cozy VR Room** live inside the headset without restarting the XR session.
  - **Seamless Controller Fallback:** Automatic 6DoF Meta Quest Touch controller mapping (`select` / `squeeze`) whenever bare hand tracking is paused.
- **Pottery Wheel Modes:** *Free Wheel*, *Guided Lessons*, and *Shape Match Challenges* across 4 crafting stages, complete with a live target silhouette guide and similarity scoring.
- **3D Clay Names Studio:** Carve, raise, smooth, stamp hearts, and hand-paint 3D embossed lettering plaques (*Tablet, Oval, Banner, Heart*)—or tap **Blank & Write** to draw custom raised 3D lettering by hand.
- **Village Pigment Brush & PBR Ceramic Glazing:** Paint seamlessly across cylindrical UV seams with 8 mineral pigments, Fine/Med/Broad brushes, Eraser, Undo, and 8 physically-based ceramic glazes (*Ocean Blue, Forest Green, Sunset Orange, Royal Purple, Pearl White, Midnight Black, Terracotta, Golden Sand*).
- **Magical Brick Kiln & `.glb` Export:** Animated kiln door, ember particles, thermal glaze reveal, local browser gallery storage, and standard `.glb` export.
- **Physics Bat Smash & Chrono Rewind:** Grab the wooden bat in Studio Gallery Smash Mode to crack and shatter finished pottery into 3D shards—then activate **Chrono Rewind** to reverse time and magnetically reassemble every piece back onto the pedestal.
- **Zero Backend & Zero API Keys:** All rendering, hand tracking (bundled local MediaPipe WASM + model), WebXR, audio synthesis, and gallery persistence run 100% locally in your browser.

---

## Trying CLAY HANDS (For Meta Quest & Judges)

### Option A — Meta Quest 2 / 3 / Pro (VR & Mixed Reality)
1. Open the hosted HTTPS deployment URL in **Meta Quest Browser**.
2. Choose **Enter VR** (`immersive-vr`) for the full sunlit pottery workshop, or **Enter MR Passthrough** (`immersive-ar`) on Quest 3 to place the tabletop wheel on your real desk.
3. Point either hand ray and **pinch** to operate the 3D spatial panel, pinch **Recenter** to align with your desk/height, or toggle **MR: Real Desk ↔ MR: VR Room** anytime.

### Option B — Desktop WebXR Emulator (No Headset Needed)
1. Install Meta's **Immersive Web Emulator** extension in Chrome or Edge.
2. Open DevTools → **WebXR** → select **Meta Quest 3**.
3. Reload the app, enter **VR** or **MR Passthrough**, and switch the emulator input between **Hand Tracking** and **Controllers**.

### Option C — Instant Browser Webcam or Mouse & Keyboard
1. Click **Start with Webcam Hand Tracking** (uses local MediaPipe WASM; camera permission is requested only after clicking **Allow Webcam & Continue**), or pick **Play with Mouse & Keyboard**.
2. Desktop shortcuts: `Z` Undo · `B` Toggle Brush · `M` Mute/Unmute · `1–4` Switch Stage.

---

## Local Development, Build & Tests

### Prerequisites
- **Node.js 22+** (LTS recommended)

### Install & Run
```bash
npm install
npm run dev
```
Open `http://localhost:3000` in Chrome, Edge, or Firefox (WebGL2 required).

### Type Check & Production Build
```bash
npm run lint
npm run build
```

### Automated Unit Tests
```bash
node --experimental-strip-types --test tests/clay-hands.test.ts
```

---

## Architecture Overview

- `src/app/` — Application orchestrator (`App.ts`), studio environment & MR backdrop control (`SceneManager.ts`), and mode/settings state (`StateManager.ts`).
- `src/xr/` — WebXR session & MR passthrough lifecycle + 25-joint hand/controller pose mapping (`XRManager.ts`, `questEnvironment.ts`) and spatial UI (`VRStudioPanel.ts`).
- `src/pottery/` — Radial clay profile & lathe geometry (`ClayGeometry.ts`, `ClayDeformer.ts`, `ClaySculptingController.ts`), wheel assembly (`PotteryWheel.ts`), brush painting (`VesselPainter.ts`, `HandBrushMapper.ts`), presets (`PotteryPresets.ts`, `PotteryProfile.ts`), and thumbnails.
- `src/names/` — 3D height-field plaque geometry & hand-sculpted lettering (`ClayNameGeometry.ts`, `ClayNameSculptor.ts`).
- `src/kiln/` — 8 PBR ceramic glazes (`GlazeManager.ts`) and animated kiln firing (`KilnController.ts`).
- `src/gallery/` — Persistent local gallery (`PotteryStorage.ts`, `GalleryManager.ts`), `.glb` exporter (`PotteryExporter.ts`), and physics smash + Chrono Rewind (`PotterySmashSystem.ts`).
- `src/tracking/` & `public/mediapipe/` — Local MediaPipe WASM/model setup (`HandTracker.ts`), calibration, gesture recognition, and smart UI cursor.
- `src/audio/` — Procedural Web Audio synthesis (`AudioManager.ts`).

---

## License & Third-Party Notices

This repository is licensed under the **MIT License** — see [`LICENSE`](./LICENSE) for full terms.

Third-party open-source dependencies used in compliance with their respective licenses (no copyleft/GPL contamination and no confidential/unreleased SDK materials):
- **Three.js** (`MIT`)
- **XR Blocks (`xrblocks`)** (`Apache-2.0`)
- **@pmndrs/uikit** (`MIT`)
- **MediaPipe Tasks Vision** (`Apache-2.0`)
