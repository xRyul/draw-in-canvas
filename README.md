# Draw in Canvas for ObsidianMD

Draw, sketch, and handwrite directly on top of Obsidian Canvas files.

Draw in Canvas adds a lightweight drawing layer to `.canvas` files while keeping the normal JSON Canvas data intact.

## Features

- **Draw on Canvas**: Add freehand strokes directly on top of Obsidian `.canvas` files.
- **Mouse, touch, and stylus support**: Draw with normal pointer input; stylus pressure is used when available.
- **Brush controls**: Pick color, size, opacity, and hardness from controls beside the canvas.
- **Optional handwriting smoothing**: Enable smoother, tapered strokes when you want handwriting-style lines.
- **Edit after drawing**: Select strokes to move, resize, recolor, restyle, or delete them.
- **Multi-select**: Use marquee selection or `Shift` / `Ctrl` / `Cmd` to work with several strokes at once.
- **Undo and redo**: Drawing actions work with standard shortcuts and the Canvas **Undo** / **Redo** buttons.
- **Saved in the canvas file**: Drawings are stored in the same `.canvas` file under `drawInCanvas`.
- **Local-only**: No network requests or external services.

## Other

- Adds a pencil button to the Canvas toolbar and drawing controls on the left.
- `Esc` leaves drawing mode, `1` returns to select mode, and `Delete` / `Backspace` removes selected strokes.
- The color picker includes presets, recent colors, hex input, and HSL/RGB/Lab controls. Use what you need; ignore the rest.
- **Allow tiny canvas items** is optional. Enable it only if you need very small cards/drawings, closer zoom, quick scale/layer controls, or stable card layering while selecting overlapping cards.
- Large canvases should stay usable, but very dense drawings can still affect performance.
- Obsidian can still open the canvas without this plugin, but plugin drawings are only visible when Draw in Canvas is enabled.


## Settings

- **Stroke color**: Default color for new strokes. Accepts CSS colors such as `#ff5a5f`, `red`, or `rgb(255, 90, 95)`.
- **Stroke width**: Default width for new freehand strokes.
- **Stroke hardness**: Softens stroke edges like brush hardness.
- **Stroke opacity**: Controls stroke transparency.
- **Handwritten strokes**: Enables smoother, pressure-aware strokes with tapered starts and ends.
- **Pen cursor fallback**: Shows a plugin cursor while drawing with a stylus when the native cursor is hidden or unreliable.
- **Allow tiny canvas items**: Lowers Obsidian's native Canvas size limit, enables closer zoom, adds quick scale/layer controls, and keeps selected cards at their saved layer instead of temporarily bringing them to front.


## 📜 License

MIT License - see [LICENSE](LICENSE).


## 🙏 Credits

- [perfect-freehand](https://github.com/steveruizok/perfect-freehand) for the handwritten stroke algorithm.
- Obsidian Canvas and JSON Canvas for the canvas format this plugin extends.
