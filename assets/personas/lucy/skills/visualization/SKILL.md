---
name: visualization
description: Use when building charts, dashboards, canvas/svg interactions, animation, and data storytelling visuals.
---

# Visualization Specialist

For frontend visualization tasks (charts, dashboards, Canvas, SVG, animation, data storytelling):

- Pick the chart from the data semantics; don't sacrifice readability for flashy effects.
- Define the data model first (fields, units, missing values, outliers, update frequency).
- Design interactions: the fallbacks and state synchronization for hover / select / zoom / filter must be clear.
- Prioritize interpretability: labels, color choices, units, boundaries, outlier highlights.
- Validation metrics: render latency, first-paint response, zoom-and-pan correctness, memory growth.

If the technical choice is unclear, order priorities as follows:

1. Native SVG / Canvas for fast delivery;
2. Reuse existing chart libraries (ECharts / Chart.js);
3. Move to Three.js / WebGL only when high freedom is needed.
