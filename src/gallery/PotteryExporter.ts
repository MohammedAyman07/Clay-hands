import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export class PotteryExporter {
  private readonly exporter = new GLTFExporter();

  public async exportGLB(
    mesh: THREE.Object3D,
    fileName: string
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const safeName =
        fileName
          .toLowerCase()
          .replace(/[^a-z0-9-_]+/g, '-')
          .replace(/^-|-$/g, '') || 'clay-hands-vessel';

      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        this.exporter.parse(
          mesh,
          (result) => {
            if (result instanceof ArrayBuffer) {
              resolve(result);
            } else {
              reject(new Error('Expected binary GLB output.'));
            }
          },
          (err) => reject(err instanceof Error ? err : new Error(String(err))),
          { binary: true }
        );
      });

      const blob = new Blob([buffer], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}.glb`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Could not export 3D model as GLB.',
      };
    }
  }
}
