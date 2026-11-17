# CLAY HANDS — Immersive Hand-Tracked Pottery Studio

CLAY HANDS is a browser-based interactive 3D pottery studio built with **TypeScript**, **Three.js**, **XR Blocks**, **MediaPipe Tasks Vision Hand Landmarker**, and procedural **Web Audio API** sound design.

Shape living, hollow radial clay on a spinning wheel using your real hands via webcam (with full Mouse & Keyboard fallback and optional WebXR VR hand tracking), apply physically-based ceramic glazes, fire your creation in a magical brick kiln, export as `.glb`, and curate your personal pottery gallery.

---

## Quick Start

```bash
npm install
npm run dev
```

Open the local Vite dev server URL (default `http://localhost:3000`) in Chrome, Edge, or Firefox.

### Production Build & Type Check

```bash
npm run lint
npm run build
```

### Automated Unit Tests

```bash
node --test tests/clay-hands.test.ts
```

---

## Webcam Permission & Hand Tracking Setup

1. Click **Enter Studio**, select a mode (*Free Pottery Studio*, *Guided Pottery*, or *Shape Challenge*), and choose **Start with Webcam Hand Tracking**.
2. Camera permission is requested **only** after you press **Allow Webcam & Continue**.
3. MediaPipe Hand Landmarker WASM and model assets are served locally from `/public/mediapipe/`, so no external cloud inference or paid API keys are required.
4. During **Hand Calibration**:
   - Hold both hands in front of your webcam to anchor the interaction zone.
   - Move both palms gently inward to calibrate your narrow shaping span.
   - Move both palms outward to calibrate your wide shaping span.
5. **Estimated Shaping Effort:** A standard 2D webcam cannot measure physical hand pressure; CLAY HANDS estimates shaping intensity from hand distance, gesture strength, and movement speed.

### Mouse & Keyboard Fallback

If you deny webcam permission, have no camera connected, or prefer desktop pointer controls, click **Play with Mouse & Keyboard** (or **Use Mouse & Keyboard Instead**):
- **Drag horizontally** toward/away from center: Compress or Widen clay
- **Drag vertically upward**: Raise vessel walls
- **Shift + Drag** (or select *Pinch*): Pinch neck / Open center
- **Alt + Drag** (or hold steady): Smooth surface
- **Ctrl + Drag** (or select *1-Side*): Shape one side
- **Brush Painting (*Brush* in Studio or *Paint Brush* in Glaze):** Choose from 8 village mineral pigments, Fine/Med/Broad brush sizes, Eraser, Undo/Clear, and toggle slow wheel spin for decorative rings. With **Webcam or WebXR Hand Tracking**, aim the 3D brush with your dominant index finger and pinch thumb + index together to paint in either Studio or Glaze.
- **Keys:** `Z` Undo (or Undo Paint when Brush active) · `B` Toggle Brush · `M` Mute/Unmute · `1–4` Switch Stage

---

## Browser Compatibility & Hardware Notes

- **Desktop Browsers:** Chrome 113+, Edge 113+, Firefox 119+, Safari 17+ (WebGL2 required).
- **Low-End Laptop Optimization:** Automatically detects software WebGL, limits webcam capture to `640×480`, supports a **Performance Mode** toggle (`15 FPS` hand inference) in Settings, uses a fixed-topology `BufferGeometry` updated in-place, and pauses updates when the browser tab is hidden.
- **Optional WebXR:** If your browser and headset support `immersive-vr` and WebXR hand tracking, an **Enter VR** button appears automatically. Desktop webcam and mouse modes require no headset.

---

## Manual Testing Checklist

- [ ] **Webcam Permission:** Press Start -> Webcam Permission screen -> allow permission -> live mirrored skeleton preview appears; test denying permission -> clear error & Mouse fallback works.
- [ ] **Hand Calibration:** Hold both hands -> move inward -> move outward -> automatic transition to Studio with saved calibration.
- [ ] **One-Hand Tracking:** Place one hand in zone -> verify gentle one-side contouring without spikes or holes.
- [ ] **Two-Hand Tracking:** Place both hands in zone -> verify live 3D hand cursors and active height ring.
- [ ] **Compressing:** Move both palms inward -> vessel narrows smoothly & wet-clay sound plays.
- [ ] **Widening:** Move both palms outward -> vessel belly widens smoothly.
- [ ] **Raising:** Lift both hands steadily upward -> walls grow taller while base stays grounded.
- [ ] **Pinching:** Pinch thumb + index finger -> narrows neck (or opens hollow interior in Stage 2); release pinch -> shape is preserved.
- [ ] **Smoothing:** Hold hands steady near spinning clay -> reduces ridges without erasing overall silhouette.
- [ ] **Brush Painting:** Select *Brush* in Studio or *Paint Brush* in Glaze -> paint pigments across the surface and seam, resize brush, erase, undo, toggle slow wheel spin, and confirm paint persists through Kiln firing, Gallery, and `.glb` export.
- [ ] **Finishing:** Press **Finish Pot** -> wheel stops, Pottery Personality name & measurements display.
- [ ] **Glaze Selection:** Switch between all 8 glazes (Ocean Blue, Forest Green, Sunset Orange, Royal Purple, Pearl White, Midnight Black, Terracotta, Golden Sand) and drag to inspect material finish.
- [ ] **Kiln Animation:** Press **Fire in Magical Kiln** -> observe door opening, vessel moving inside, ember glow & particles, glaze transformation, cool-down, and reveal.
- [ ] **Gallery Saving & GLB Export:** Save creation, open Gallery, rotate/inspect saved 3D vessel, rename, delete, and export `.glb`.
- [ ] **Mouse Fallback:** Complete full pottery -> brush paint -> glaze -> kiln -> gallery workflow using only Mouse & Keyboard.
