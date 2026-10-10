# The graphics upgrade

The kitchen was built low-poly on purpose: flat-shaded facets, matte paint in vertex colors, no textures and no reflections.
Daniel asked on 2026-10-09 to take it to a much higher standard and steer away from that style.
This is the direction, written before the work, and what each stage was judged against; what was done and what it cost are at the end.

The frames in `graphics-upgrade/before/` and `graphics-upgrade/after/` are shot by `node scripts/viewpoints.ts` from twelve fixed viewpoints, on the real GPU, at 8 p.m., with the interface hidden.

## What reads as cheap today

Shot at 1440 by 900, high tier, evening.

- **Suite** (`before/suite.jpg`): the steel reads as grey plastic; nothing in it reflects, so the hood's lit grid, the lamps and the room never show in it.
  The stockpot is an octagonal prism, the copper rondeau an orange dodecagon with a flat lid, the knobs little boxes.
  Every edge is a hard 90 degree corner, so the counter's outline is a cardboard silhouette, and the cast iron tops are flat brown planes.
  The hood's underside is a dark brown drop ceiling with white discs.
- **Pass** (`before/pass.jpg`): the food is cubes, hexagons and flattened icosahedra on twelve-sided plates.
  The pass's front is one dark brown plane with no steel to it.
  The heat lamps light the floor at the foot of the pass straight through its top, two warm pools where its shadow should be.
- **Islands** (`before/islands.jpg`): the charcoal tops are flat black slabs, the marble slab a white rectangle, the croquembouche's choux faceted beads.
  The mixer is three rounded boxes; the rolling pin a brown bar.
  The pendant is a twelve-faceted brass dome; the island's legs and shelves are square sticks.
- **Window counter** (`before/window-counter.jpg`): white cabinets as flat planes, the sinks dark rectangles with no basin, and the view outside is cones and blobs, faceted on purpose, that now clash with anything finer inside.
- **Vault** (`before/vault.jpg`): the vault is twelve flat bands, each one a shade, and its silhouette against the end walls is a polygon.
  The walls are one flat beige with nothing at the scale of a hand; at the end of the room they read as cardboard.
- **Floor** (`before/floor.jpg`): one flat tone in metre panels with a hairline between them, no sheen, no wear, no reflection of the pools of light.
  Fixtures float on it: nothing darkens where a plinth meets it.
- **Walk-in** (`before/walk-in.jpg`): the steel door is a flat brown-grey plane with a box for a handle; the frame is four boxes.
- **Desk** (`before/desk.jpg`): the butcher block is a flat red-brown slab, the CRT and tower beige boxes, the keyboard one slab and the corkboard flat brown.

The light itself is right: warm pools from the kitchen's own lamps, the blue hour outside, warm blacks, bloom on the lamps.
What fails is everything the light lands on.
Another finding: three.js r186 ignores a material's `envMapIntensity` whenever it reflects `scene.environment` (`WebGLRenderer.setProgram` replaces it with `scene.environmentIntensity`), so the metals' 12 to 14 never applied and every metal reflected at 0.05.

## The target

Evening service in a working three-star kitchen, photographed: Gusteau's kitchen in Ratatouille for the warmth, the French Laundry's kitchen for the room.
A visitor should know what every surface is made of at a glance, from its color, its sheen and the size of its detail.
Brushed stainless steel with soft, streaked reflections of the lamps and the room, and the odd scratch.
Copper with a deep rosy sheen, darker where it has been on the flame, its lining bright tin.
White glazed tile with grout lines, each tile a little different in tone and flatness.
Honed charcoal stone, pale veined marble, oiled butcher block, porcelain that catches the light along its rim.
A pale stone floor with a satin sheen that reflects the pools of light, worn smoother where cooks stand.
Edges that catch light because they are rounded, and things that sit in their own contact shadows.
Food that looks good enough to eat.

It must not look like a tech demo: no chrome, no wet look, no lens flares, no noise that does not mean anything.
The look rules stay: the evening is the reference hour, warm blacks, glowing paint dim, the environment for reflections only.

## The material system

Every static surface still goes through `Kit`, merged into one mesh per material, so the draw calls stay where they are.
A layer is a material class: its shader and its set of textures.
What differs between the parts of one layer is per vertex: the paint (vertex color, multiplied into the texture's color) and a finish (a roughness multiplier), so a glazed beet and a crust of bread can share the food material.

- **Textures are painted on the GPU at load**, by a fragment shader per recipe into mipmapped, anisotropically filtered, repeating render targets (`world/surfaces/`).
  Nothing is downloaded, nothing is committed as an image, and a whole set takes milliseconds.
  Each recipe is periodic noise and patterns (cells, strips, cracks, brush lines), so every texture tiles without a seam.
  A recipe writes color, a height field (made into the normal map) and roughness (carried in the normal map's alpha), so a surface costs two textures, or one when its paint is its color.
- **Texture coordinates are meters.**
  The builder gives every part real-world texture coordinates as it merges it: flat parts are projected along their face normal (boxes, walls, the floor), round parts unroll their own coordinates to their circumference and height (pots, rods, bowls).
  A texture then says how many meters one repeat covers, so a tile is the same size on every wall and grain the same size on every board.
- **Repetition is broken in the shader, not by bigger textures**: what must not visibly repeat (the floor's tiles, the wall's tiles) takes its per-tile variation from a hash of the tile's cell in world space.

| Layer     | What                                                                                                                            | Scale             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `floor`   | Pale honed stone tiles, 50 cm, thin dark grout, per-tile tone and polish, a satin sheen, worn smoother and darker in the aisles | one repeat 2 m    |
| `tile`    | Large white glazed tiles, 60 by 30 cm, stacked, grout nearly their own color, on the walls up to the vault                      | one repeat 1.2 m  |
| `plaster` | Warm white matte paint over plaster: the vault, the arches at the ends, the hood's body, reveals                                | one repeat 2 m    |
| `steel`   | Brushed stainless: fine brushing, smudges and scratches in its normal and roughness                                             | one repeat 0.5 m  |
| `iron`    | Seasoned cast iron and black enamel: the cooking tops, grates, knobs, plinths                                                   | one repeat 0.5 m  |
| `copper`  | Hammered copper with a darker patina toward the flame                                                                           | one repeat 0.3 m  |
| `brass`   | Brushed brass with a little tarnish                                                                                             | one repeat 0.3 m  |
| `stone`   | Honed charcoal stone and polished veined marble (one texture, painted dark or pale)                                             | one repeat 1 m    |
| `wood`    | Butcher block: strips of maple with their grain                                                                                 | one repeat 0.5 m  |
| `gloss`   | Porcelain glaze and enamel paint: plates, bowls, the mixer, cabinet doors                                                       | smooth            |
| `matte`   | Cloth, paper, card, plastic, rubber                                                                                             | one repeat 0.25 m |
| `food`    | Food, its finish set per part: glazed, crisp, creamy                                                                            | one repeat 0.1 m  |

Glass, the night windows, the lamps and signs, and the walk-in's baked room keep their materials.

## Scale rules

- Real sizes first: a wall tile is 60 by 30 cm, a floor tile 50 cm, a board's strip 4 cm, steel brushed at about a millimeter.
- Detail that cannot be resolved where it is seen is not drawn: textures are mipmapped and filtered anisotropically, so grout and brushing average out with distance instead of shimmering.
- Nothing has a sharp edge unless it is paper or a seam: steel and stone edges round off over 3 to 10 mm, cabinet doors over 2 mm, tops are eased.
- Round things are smooth-shaded and have enough sides that their facets never show from a meter away: sides from the radius, so the gap between a facet and the true circle stays under a millimeter or so.

## Geometry

- Boxes that are seen up close get a rounded edge with face-weighted normals, not a chamfer that catches light as its own facet.
- The vault is a smooth arc; its 12 flat facets stay the knife solid, which the arc never strays from by more than 1.3 cm.
- Pots, pans, bowls and plates are turned from profiles: thickness, a rolled rim, an inside, a base.
- What a knife sticks into keeps agreeing with what is drawn, within `knifeSolids.test.ts`'s 2 cm.

## Grounding and reflections

- **A reflection probe of the kitchen**: a cube map of the room captured once at load (and again when the hour's light moves on), filtered for roughness, and box-projected onto the room's box, so the floor, the steel, the copper and the night windows reflect the lamps, the light lines, the windows and the walls where they really are.
  Every kitchen material reflects it at full strength (Fresnel decides how much), and takes only the tiny environment intensity from it as light, as before.
- **Contact shadows**: the ambient occlusion pass stays, retuned; the floor and the foot of the walls darken under and beside the fixtures from a map painted from the layout at load.
- **The lamps over the islands cast shadows**, rendered once, since what they light does not move.
  The heat lamps over the pass were meant to as well, so the pass would stop their light reaching the floor; five shadow maps cost too much for that, and their reach ends above the floor instead.

## Performance budget

Measured with `node scripts/perf.ts` (16 players, bots throwing), `--dpr 2`, and `--uncapped` for the real cost of a frame.

|                                                | Before                                             | Budget                                  | After                                              |
| ---------------------------------------------- | -------------------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| dpr 1, capped                                  | 60 fps, governor 0, 76 draw calls, 130 k triangles | 60 fps, governor 0, about 80 draw calls | 60 fps, governor 0, 86 draw calls, 709 k triangles |
| dpr 1, uncapped                                | 182 to 189 fps on a quiet machine                  | no worse than a third slower            | 125 to 131 fps (about 30 % slower)                 |
| dpr 2, capped                                  | 59 to 60 fps, governor 1                           | playable, governor at most 2            | 60 fps, governor 1                                 |
| dpr 2, uncapped                                | 48 to 53 fps                                       |                                         | 40 to 41 fps                                       |
| Load to "Enter the kitchen" (production build) | 0.90 s high tier, 0.90 s low                       | within 0.2 s of before                  | 1.03 s high tier, 0.96 s low                       |
| Texture memory                                 | none                                               | under 64 MB                             | about 79 MB                                        |

The before column was measured again at the end, alternating with the after build on the same machine (`DECISIONS.md` has the runs).
Draw calls and texture memory went over budget, each by a little: ten more draw calls for five new layers and the cooks' buttons and aprons, and texture memory for the floor's and the walls' full-size maps.

## The low tier

Software renderers and phones get the same geometry with smooth shading and the same paint, with plain materials: no textures, no probe, no post-processing, so SwiftShader stays fast and the E2E suite runs as before.
The texture painter, the probe and the extra shadows exist only on the high tier.

## Checking

- `node scripts/viewpoints.ts` after every stage, compared with the before frames at full size and at device pixel ratio 2.
- `node scripts/perf.ts` and `--dpr 2` after every stage, plus `--uncapped`.
- `npm run lint && npm run typecheck && npm test`, and `knifeSolids.test.ts` and `outside.test.ts` in particular.

## What was done

Four stages, each judged against the before frames and measured before and after (`DECISIONS.md` records the calls in each).

1. **Materials and reflections**: textures painted on the GPU at their real sizes for every layer in the table, texture coordinates in meters from the builder, a finish per part, smooth shading everywhere, and the box-projected probe as every kitchen material's own `envMap`.
2. **Real forms**: rounded edges, a true barrel vault, a French range with brass bands, rails and bezelled knobs, baffle filters in the hood, marble on the window counter, round island legs, wire shelving, turned plates, bottles and knobs, and the desk rebuilt.
3. **Grounding**: the floor's contact shade and wear painted from the layout, the islands' lamps casting shadows drawn once, the heat lamps' reach ending above the floor, and the hood lit by three downlights instead of one area light.
4. **Props, dishes, the view outside and the cooks**: pots and pans turned from profiles, the stations' food modeled, the five dishes on the pass remade under softer lamps, the view outside lit per corner, and smooth cooks with a pleated toque, buttons and an apron.

The last look found the pass reading black from the dining room (now brushed satin), the wall tiles looking wet (now a satin glaze), and both signs blank, their pictures stretched by texture coordinates in meters (`builder.test.ts` now checks they show whole).

## Before and after

Twelve viewpoints, the same names in `before/` and `after/`: `suite`, `pass`, `islands`, `window-counter`, `vault`, `floor`, `walk-in`, `desk`, `dishes-west`, `dishes-middle`, `dishes-east` and `cooks` (four cooks stood facing the camera with `&cooks=4`).
The last four were added during the work; their before frames were shot from the commit that wrote this direction, with only `?cooks` added to it.

## The low tier, as built

It gets the same geometry with fewer sides (a facet may stray 2.5 mm from the circle instead of 0.6), smooth shading and the same paint, with plain materials and no textures, probe, extra shadows or post-processing.
It loads in 0.96 s instead of 0.90 s, the extra spent building the finer geometry, and the E2E suite runs on it as before.

## Where it falls short

- **Sinks are not recessed**: a basin deeper than 2 cm would leave knives sticking in the air over it unless the knife solids changed, which changes the shared simulation and `PROTOCOL_VERSION`, for a detail seen from above.
- **No anisotropic highlights on the brushed steel**: three.js derives their direction from screen derivatives that come out degenerate on rounded edges, and threw sparks; the brushing is in the normal and roughness maps.
- **One probe for the whole room**: box projection puts reflections of the walls, lamps and windows where they are, but things in the middle of the room (the hood, the suite) are reflected as if on the walls; cooks and knives are never in it.
- **The islands' lamps shadow only what does not move**: cooks under them cast no shadow from them.
- **The hand and the knives on screen are as they were**: another agent owns them.
- **The view outside is still made of simple shapes**, now lit smoothly; trees with real crowns and leaves would be its own piece of work.
