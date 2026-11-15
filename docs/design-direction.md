# SAR-BRIDGE visual system: Mission / paper

The entry screen is an interactive application: an ink introduction adjoining the real optical map, followed by an open provenance band and a three-step investigation rail. The analysis workspace keeps light paper surfaces and prioritises the map, four measured statistics and a compact evidence inspector.

- Palette: ink `#101c25`, paper `#ffffff`, page `#eef2f3`, amber action `#eab16e`, loss `#b76142`, gain `#527a94`. Evidence semantics retain green, amber and red.
- Type: Public Sans for editorial headings and controls; IBM Plex Mono for provenance, pixel counts and dates. No serif headings in the new system.
- Components: original orbit mark; dark navigation with active amber underline; four-pixel buttons; flat measurement band; open provenance rail; disclosure rows; separate engine and human statuses.
- Motion: a short evidence-panel entrance and existing radar-divider demonstration; respect reduced-motion preferences. Maps and measurements never animate as invented live telemetry.
- Entry copy: “See the change. Follow the evidence.”; “Two radar observations. One changing reservoir. Investigate the shoreline of Mingachevir, Azerbaijan.”; “Explore the change”; “Open full workspace”; the real dominant change measurement and interval; “Provisional radar classification. Not field validated.”
- Responsive: desktop ink/map split; mobile introduction above the map, provenance in two columns, investigation rail stacked. All analysis and review controls remain available.

The coordinated ImageGen intro and workspace concepts are visual references only. Production uses the existing, real NISAR and Sentinel-2 rasters and the original Leaflet geometry/chart. Concept-map geography, illustrative patch locations and chart estimates are intentionally replaced by the actual exports. Keep the existing brand mark and scientific caveats. No NASA insignia or endorsement claim, simulated alert feed, deformation measurement, forecast or fabricated metric is introduced.

`web/css/mission.css` owns the new visual layer; existing modules retain map, data, evidence, report and local review behaviour. Possible explanations now use the same disclosure family as the remaining evidence sections. The workspace review actions occupy a separate, fixed footer so scrolling the evidence cannot hide them. Required provenance, raster attribution and scientific cautions remain visible even when the concept simplifies them.

## Separate dashboard

The dashboard concept extends the same tokens and header with a Dashboard navigation item. It uses a flat four-measurement band, a loss-sorted sector table, and a right rail for optical comparison and local review coverage. Mobile uses a scrollable table with sticky sector names, followed by the comparison and review rail. Buttons retain the existing code-native control family.

Counts are computed from the current observation package and exact-version local reviews. Four significant sectors are distinct from the ten sectors with nonzero or zero measured changes; one sector with multiple review records counts once. Engine totals always describe all sectors, independently of the table filter. Inaccessible storage is shown as unknown coverage.

The concept's duplicated “Area” column is omitted: those illustrated values repeat radar loss, not sector area. Production uses one accurately labelled Radar loss column, actual values and status labels, the existing brand mark and the source package ID. Map/review/report actions open the existing working modules; no standalone generated image is used as UI.
