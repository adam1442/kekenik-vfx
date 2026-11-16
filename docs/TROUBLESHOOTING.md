# Troubleshooting

## The page says WebGPU is not available / the GPU is not detected

Kekenik VFX needs a browser with WebGPU on a secure origin (`https://` or `http://localhost`).

1. **Update** the browser and the graphics driver. Chrome and Edge 113+ enable WebGPU by default on Windows, macOS and ChromeOS;
   Linux and Android depend on the version and GPU. Firefox and Safari have been adding WebGPU in recent releases (Firefox: `dom.webgpu.enabled` in
   `about:config` on builds where it is not yet on by default; Safari 26 / macOS 26 and iOS 26 enable it by default). Check each browser's
   current support notes.
2. Open `chrome://gpu` (or `edge://gpu`) and look at **WebGPU**. If it says *Disabled*, check *Graphics Feature Status* for the reason
   (blocklisted driver, hardware acceleration off).
3. Make sure **hardware acceleration** is on (Settings → System).
4. Linux: try `chrome://flags/#enable-unsafe-webgpu` and `#enable-vulkan`, then restart the browser. Install current Mesa or
   vendor drivers.
5. Use the buttons on the diagnostics screen: **Retry**, **Continue in limited mode** (a bare device without optional features) and **Try software
   renderer** (a CPU-based adapter such as SwiftShader; slow but useful for checking projects).
6. You can force a minimal start with `?safe` in the URL (for example `https://adam1442.github.io/kekenik-vfx/?safe`).
7. When you report a bug, press **Copy diagnostics** and paste the text into the issue.

## The viewport turns black or the GPU was reset

The app recreates the GPU device automatically (three attempts) and re-renders the project. If recovery fails, a diagnostics overlay
appears and the project stays in memory and autosaved. Press **Retry**, or reload the page; your autosave is offered at startup.

## "Memory pressure" toast, out-of-memory, tab crashes

- Lower the **Memory budget** or the **Preview quality** in Settings → Quality & memory.
- Use a smaller graph resolution while editing; large exports are rendered tile by tile.
- Close extra viewports and run *Free GPU Memory* (Help / command palette).
- Export to a folder (Chrome / Edge) instead of a ZIP download for very large images.

## Slow interaction

Open the **Profiler** panel (Nodes tab) to find the expensive node. Enable *Adaptive preview*, lower *Preview quality*, bypass the node
(`B`) or reduce its resolution. **F3** shows the performance overlay.

## Shader error badge on a node

Open the **Console** panel and click the entry; the WGSL line is listed. Please report the node id and the diagnostics text.

## Rendering looks wrong only in one browser

Try another browser, or start with `?safe`. `?nobgcache` disables the bind-group cache and `?noworkers` disables web workers; both are
useful to narrow down driver problems when reporting an issue.

## Persian text looks wrong

The interface uses the system font stack. Install a Persian font (for example Vazirmatn, SIL OFL 1.1) on your system, or self-host
it as described in `public/fonts/README.md`.

## Reset everything

Clearing the site data for the page (browser settings → Privacy → Site data) removes settings, layouts and autosave slots.
