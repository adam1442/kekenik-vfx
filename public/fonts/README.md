# Self-hosted fonts

The app uses a system font stack (`ui-sans-serif, system-ui, "Segoe UI", "Vazirmatn", Tahoma, Roboto, ...`) and loads nothing from the network.

To ship a font yourself, drop the files here (for example `Vazirmatn[wght].woff2` and/or `Inter[wght].woff2`) and uncomment the block
below in `src/ui/theme/modern.css` (paths are relative to the built `index.html`). Persian text is rendered with Vazirmatn when present,
then Segoe UI / Tahoma / the system font.

```css
/*
@font-face {
  font-family: 'Vazirmatn';
  src: url('./fonts/Vazirmatn[wght].woff2') format('woff2');
  font-weight: 100 900;
  font-display: swap;
  unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFF, U+200C-200D;
}
@font-face {
  font-family: 'Inter';
  src: url('./fonts/Inter[wght].woff2') format('woff2');
  font-weight: 100 900;
  font-display: swap;
}
*/
```

Then put `Inter` at the front of `--font` if you want it for Latin text. Only weights 400 / 500 / 600 are used by the UI.
