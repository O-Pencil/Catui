# Scientific Visualization

Use this playbook for research figures, tables, diagrams, or visual audits.

## Evidence first

Record audience, medium, target venue if known, variable meanings and units, estimator, uncertainty definition, sample/replicate structure, missing/censored values, source run/analysis IDs, transformations, and intended output size.

Choose an encoding that preserves meaning:

- prefer position on a common scale;
- show raw observations when feasible;
- name uncertainty as SD, SE, CI, percentile, posterior interval, or another explicit quantity;
- distinguish zero, missing, censored, excluded, and out-of-range values;
- disclose filtering, aggregation, normalization, smoothing, binning, and image adjustments;
- avoid decorative 3D, misleading dual axes, truncated bar baselines, and visual area/radius mismatches;
- use color redundantly with markers, line styles, hatching, direct labels, or panels.

Never remove inconvenient points, connect across missing observations, rescale images as if detail increased, or tune axes to manufacture an apparent effect.

## Delivery

Preserve source data and plotting code. Export at the intended physical size, inspect the actual rendered file, verify labels/units/legends/panel references, and provide alt text plus an accessible data table when appropriate. Treat journal-specific format and resolution rules as pending until verified against current official guidance.

Bind each figure to analysis and evidence IDs; a polished figure is not independent evidence.
