# Draw in Canvas

Draw in Canvas is an Obsidian plugin prototype for drawing freehand strokes on top of `.canvas` files.

It keeps the canvas JSON compatible by storing strokes in a custom top-level `drawInCanvas` metadata property.

## Development

Install dependencies:

```bash
pnpm install
```

Build and copy the plugin into the WSL-mounted testing vault at `D:\plugin-testing-vault\`:

```bash
pnpm build
```

The build writes these files to:

```text
/mnt/d/plugin-testing-vault/.obsidian/plugins/draw-in-canvas/
```

You can override the target vault with:

```bash
OBSIDIAN_TEST_VAULT=/mnt/d/another-vault pnpm build
```

or, from WSL, with a Windows-style path:

```bash
OBSIDIAN_TEST_VAULT='D:\plugin-testing-vault' pnpm build
```

For watch mode:

```bash
pnpm dev
```

## Usage

1. Open a `.canvas` file in Obsidian.
2. Existing Draw in Canvas strokes are shown automatically.
3. Use the pencil button in the right canvas controls, between **Canvas settings** and **Zoom in**, or run **Draw in Canvas: Toggle drawing mode on active canvas**.
4. Long-press or right-click the pencil button, or focus it and press `ArrowDown`, to choose a predefined stroke color and adjust stroke size with the slider. Opening this palette also enables drawing mode, and a visual dot preview shows the selected size while you drag the slider.
5. Enable **Handwritten strokes** in the plugin settings to smooth lines and use tapered, less perfectly round starts and ends.
6. Drag anywhere on the canvas to draw. Press `Esc`, select the pencil button, or run the toggle command again to stop drawing.
7. Leave drawing mode, then select and drag an existing stroke to move it.
8. Drag on an empty canvas area to use Obsidian's native marquee selection; it selects native canvas cards and Draw in Canvas strokes together.
9. Drag from inside the selected bounding box to move the whole selected group, even when the pointer is not directly on a stroke line.
10. Drag a corner handle on the selected bounding box to resize selected strokes larger or smaller.
11. Use `Shift`/`Ctrl`/`Cmd` while selecting strokes to build a multi-selection, then press `Delete` or `Backspace` to erase the selected strokes.
12. Use the canvas **Undo** / **Redo** buttons for Draw in Canvas actions from the current session, or use **Clear drawings from active canvas** as needed.

## Notes

- Drawings are saved into each `.canvas` file under `drawInCanvas`.
- The plugin is local-only and does not make network requests.
- The Obsidian canvas DOM is internal API, so this prototype may need small selector updates if Obsidian changes its canvas markup.
