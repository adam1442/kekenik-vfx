# Roadmap

This list describes ideas and known gaps that are open for contribution. It is a wish list, not a promise. Open an issue before
starting larger work so the design can be discussed.

## Known limitations

- **Browser support**: WebGPU is required. There is no WebGL fallback and the software adapter is slow.
- **Pass fusion**: only chains of simple per-pixel nodes are fused; other adjacent nodes still run as separate passes.
- **CPU mesh nodes** run on the main thread unless they are explicitly worker-enabled; very large meshes can stall the UI.
- **Image formats**: DDS export is uncompressed (no block compression, no mip chains). There is no KTX2 or WebP encoder.
- **Mobile / touch**: pointer events are supported, but the docking UI is designed for desktop screens.

## Ideas

- Block-compressed texture export (BC/ASTC) and mipmap generation.
- More simulations (smoke with temperature, SPH-style particles) and more vector-field tools.
- Additional bundled samples and a community gallery format.
- Per-node GPU timing history in the Profiler and a project-level performance report.
- A headless export mode (CLI) using a software adapter, for build pipelines.
- Additional languages (see [I18N_GUIDE.md](I18N_GUIDE.md)).
- Splitting the main application chunk further (node definitions could load on demand) to reduce start-up download size.
- End-to-end browser tests that run on a GPU-enabled CI runner.
