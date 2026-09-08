# Export artefacts (PR evidence)

Produced by the real export functions, not mocked:

| file | chart type | produced by |
|---|---|---|
| `market-volume.{csv,png}` | StackedAreaChart | `csvFromSeries` / `exportSvgDocument` |
| `resale-vs-gacha.{csv,png}` | CompositionChart | same |
| `holders.{csv,png}` | MetricBarCard | same |
| `og-stats.png` | `/stats` OpenGraph card | `renderOgCard` |
| `embed-test.html` | cross-origin iframe harness | serve from any other origin |

The PNGs were assembled by `exportSvgDocument` (the pure half of `pngFromSvg`)
and rasterized with sharp, because the browser-only half is a canvas call. Each
carries the chart's title, its window and as-of, its honesty note, the legend,
the ghosted lockup and the host.

Data as of 2026-09-06 — regenerate rather than trust these numbers.
