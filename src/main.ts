import * as xb from 'xrblocks';
import { ClayHandsApp } from './app/App.ts';

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function checkWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const ok = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

export async function bootstrapClayHands(): Promise<void> {
  if (!checkWebGLAvailable()) {
    const uiRoot = document.getElementById('ui-root') ?? document.body;
    uiRoot.innerHTML = `
      <div class="screen screen-modal">
        <div class="panel-card">
          <p class="eyebrow">GRAPHICS UNAVAILABLE</p>
          <h2>WebGL Could Not Start</h2>
          <p class="body-copy">CLAY HANDS requires WebGL to render the 3D pottery wheel and clay mesh. Please enable hardware acceleration or use a modern desktop browser.</p>
        </div>
      </div>
    `;
    return;
  }

  const isSoftwareGl = detectSoftwareWebGL();
  const container = document.getElementById('canvas-container') ?? document.body;
  const canvas = document.createElement('canvas');
  canvas.id = 'studio-canvas';
  container.appendChild(canvas);

  const options = new xb.Options();
  options.canvas = canvas;
  options.antialias = !isSoftwareGl;
  options.xrButton.enabled = false;
  options.xrButton.alwaysAutostartSimulator = false;
  options.enableSimulator = false;
  options.enableVR();
  options.enableHands();
  options.hands.visualization = true;
  options.hands.visualizeMeshes = true;
  options.hands.visualizeJoints = false;
  options.enableReticles();
  options.controllers.visualizeRays = true;
  options.setAppTitle('CLAY HANDS');
  options.setAppDescription(
    'An immersive hand-tracked 3D pottery studio.'
  );

  const app = new ClayHandsApp(isSoftwareGl);
  xb.add(app);
  await xb.init(options);
}
