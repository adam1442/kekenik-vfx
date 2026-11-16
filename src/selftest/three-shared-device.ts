import type { GpuContext } from '../engine/gpu/device';

/**
 * three.js shared-device check.
 *
 * Finding (verified by reading three@0.187.0 build/three.webgpu.js, WebGPUBackend.init, ~line 48800):
 *   `new WebGPURenderer({ device })` is SUPPORTED. When `parameters.device` is given three skips adapter /
 *   requestDevice and uses ours; on dispose it does NOT destroy a device it did not create.
 * Caveats:
 *   - three sets `compatibilityMode = !device.features.has('core-features-and-limits')`. Our GpuContext requests that
 *     feature when the adapter offers it. On older browsers that do not know it, three thinks it is in compat mode
 *     (no MSAA). This is harmless for the viewport but is reported here.
 *   - three/webgpu is dynamically imported (lazy) so 2D-only sessions never pay the parse cost.
 *   - Zero-copy texture interop: three.ExternalTexture wraps a raw GPUTexture (see `texture interop` result).
 *
 * `runThreeSharedDeviceCheck` is executed by the GPU test harness (development server only) to validate this at runtime on a real GPU.
 */
export interface ThreeDeviceCheckResult {
  ok: boolean;
  sharedDevice: boolean;
  compatibilityMode: boolean | null;
  externalTexture: 'supported' | 'unsupported' | 'failed';
  notes: string[];
}

export async function runThreeSharedDeviceCheck(gpu: GpuContext): Promise<ThreeDeviceCheckResult> {
  const notes: string[] = [];
  const result: ThreeDeviceCheckResult = { ok: false, sharedDevice: false, compatibilityMode: null, externalTexture: 'unsupported', notes };
  const THREE = (await import('three/webgpu')) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const renderer = new THREE.WebGPURenderer({ canvas, device: gpu.device, antialias: false });
  try {
    await renderer.init();
    const backend = renderer.backend as { device?: GPUDevice; compatibilityMode?: boolean };
    result.sharedDevice = backend.device === gpu.device;
    result.compatibilityMode = backend.compatibilityMode ?? null;
    notes.push(`renderer.backend.device === our device: ${result.sharedDevice}`);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    camera.position.z = 3;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff8800 }));
    scene.add(mesh);
    await renderer.renderAsync(scene, camera);
    notes.push('rendered a box with three using the shared device');

    if (typeof THREE.ExternalTexture === 'function') {
      try {
        const tex = gpu.device.createTexture({
          size: [4, 4],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        const ext = new THREE.ExternalTexture(tex);
        mesh.material = new THREE.MeshBasicMaterial({ map: ext });
        await renderer.renderAsync(scene, camera);
        tex.destroy();
        result.externalTexture = 'supported';
        notes.push('ExternalTexture(GPUTexture) rendered OK (zero-copy engine->three texture path works)');
      } catch (e) {
        result.externalTexture = 'failed';
        notes.push(`ExternalTexture failed: ${(e as Error).message}`);
      }
    } else {
      notes.push('THREE.ExternalTexture not present in this build: use a copyTextureToTexture bridge into a three-owned texture.');
    }
    result.ok = result.sharedDevice;
  } finally {
    renderer.dispose();
  }
  // Our device must still be alive after three disposed.
  const { error } = await gpu.scope('validation', () => gpu.device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST }).destroy());
  if (error) {
    result.ok = false;
    notes.push(`device unusable after three.dispose(): ${error.message}`);
  } else notes.push('device still usable after three.dispose()');
  return result;
}
