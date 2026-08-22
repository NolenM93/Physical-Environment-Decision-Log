# Stanza

A spatial decision log for the furniture you already own.

Stanza turns an ordinary room photograph into a measured 3D model, lets you rearrange
the pieces that are already in the room, and then keeps a record of every arrangement
you tried and why you rejected it. It does not sell you a sofa. It tells you whether the
one you have will fit, whether the door still opens, whether anyone can get to the
window, and how many people it will take to move it there on Saturday.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, click **Open the demo room**, and you land in a fully
populated living room with two competing arrangements and a decision history.

## Why it works differently

Most photo-to-3D tools stop at the picture. The picture is the easy half. The hard half
is the decision — which arrangement you actually commit to, and remembering next spring
why you moved the bookcase back. Stanza is built around four ideas:

**Metric, not decorative.** Every reconstruction carries real dimensions in metres,
derived from camera calibration rather than guessed from a texture. If the plan says
there are 82 cm between the coffee table and the sofa, that is a number you can act on.

**Constraints, not vibes.** A layout is continuously evaluated against how rooms are
actually used: door swings, walking routes, reach to outlets, viewing distances, the
patch of sun that crosses the floor in February.

**Effort is part of the design.** Each candidate arrangement is priced in minutes,
people, and metres dragged across the floor. An arrangement that is 4% better but needs
two people and an hour is a different proposal from one you can do alone before lunch.

**Decisions persist.** Arrangements fork from one another into a tree. Each one can be
adopted, rejected, or parked with a written rationale and the metrics as they stood at
the time. The log is the product.

## The pipeline

### 1. Capture and calibration

Upload one photograph. A Web Worker runs the vision pass so the interface never blocks:

- A lightweight LSD-style **line segment detector** — greyscale, Gaussian blur, Sobel
  gradients, then region growing over pixels with consistent gradient orientation,
  finished with a principal-axis fit.
- **Vanishing point estimation** by RANSAC over segment intersections, under a
  Manhattan-world assumption (rooms are mostly boxes, and that is a gift).
- **Camera calibration** recovered from orthogonal vanishing points. Each perpendicular
  pair gives one focal length through `(vᵢ − p)·(vⱼ − p) + f² = 0`; they are combined by a
  median weighted on how many independent lines voted for each direction, which matters
  more than it sounds — two long, nearly parallel edges look like strong evidence and
  intersect at a point that slides hundreds of pixels under a fraction of a degree of
  noise. The principal point can be refined to the orthocentre of the vanishing-point
  triangle, but only when all three directions are well supported and the answer stays
  near the image centre, because that estimate is where accuracy goes to die.

You give one real number — roughly how high the camera was — and that fixes the scale of
everything else. Camera height is a pure multiplier, so nudging it rescales the model
instantly without re-running the vision pass.

### 2. Reconstruction

Mark the floor quad and box the furniture (by hand, or with the optional AI detector).
Each 2D box is lifted into a metric object: the footprint is back-projected onto the
floor plane, depth is inferred from category priors where the photograph cannot see it,
and height comes from the top edge of the box under the recovered camera. Wall-mounted
things are projected onto the nearest wall plane instead.

Height needs one piece of care that is easy to miss. The topmost pixel of a piece is not
above the line where it meets the floor: if the piece is lower than the lens you are
looking down onto its top surface, so the highest pixel belongs to its *back* edge.
Measuring that against the front edge inflates a coffee table by half again, so the lift
solves the height, checks whether the result is below the camera, and re-solves against
the back edge when it is.

`Studio → Photo` overlays the reconstructed model back onto the original photograph in
wireframe, which is the honest way to show you how good the calibration actually is.

### 3. The studio

- **3D view** with procedurally generated furniture — no asset downloads, geometry built
  from each piece's real dimensions and category. Walls between you and the room fade out
  as you orbit.
- **Plan view**, a real drafting surface with live dimension readouts while you drag.
- Dragging snaps to walls, squares up to neighbours, and aligns edges, with grid
  fallback. Collisions are resolved with the separating axis theorem.
- Everything is undoable.

### 4. The constraint engine

Runs on every change (deferred, so a drag stays at 60fps) and reports blockers, warnings,
and notes:

| Check | What it means |
| --- | --- |
| Overlap and containment | Pieces intersecting each other or leaving the room |
| Door swings | The arc a door needs, kept clear |
| Circulation | Flood fill over an occupancy grid — can you reach every part of the room? |
| Clearance | Distance transform; tight gaps read red, generous read green |
| Access zones | The room a drawer, a bed side, or a sofa seat needs in front of it |
| Power | Reach from each appliance to the nearest outlet, cable length included |
| Daylight | NOAA solar position, projected through windows onto the floor for any date and hour |
| Ergonomics | Viewing distances, conversation distances, wall preferences |

### 5. The move plan

Diff two arrangements and get numbered instructions in a workable order — pieces that
have to move out of the way go first, staged in free floor space, and come back at the
end. Each step carries an estimate of time, people needed, and the path itself, routed
with A* around whatever is still standing in the room. Print it and hand it to whoever is
carrying the other end.

## Checking that the measuring works

A room planner that quietly measures wrong is worse than one that refuses to measure, so
the geometry is tested against ground truth rather than eyeballed.

`scripts/make-room-photo.mjs` renders a 4.6 × 3.8 m room through a pinhole camera whose
focal length, pose and furniture positions are all written down. `npm run check:calibration`
feeds those pixels to the real pipeline and compares what comes back:

| | recovered | truth | off by |
| --- | --- | --- | --- |
| Focal length | 872 px | 900 px | 3.1% |
| Principal point | 720, 510 | 720, 510 | 0.0% |
| Room width × depth | 4.71 × 3.87 m | 4.6 × 3.8 m | 2.4%, 1.9% |
| A metre drawn on the floor | 1.017 m | 1.000 m | 1.7% |

Furniture footprints land within about 10%, and that gap is structural rather than a bug
worth chasing: an axis-aligned box in the image cannot tightly bound a footprint that is
rotated in the room, so the contact line it implies is a little too wide and a little too
near. Segmentation masks would fix it; bounding boxes will not. The check enforces a
budget on every one of these numbers and fails if the geometry regresses.

The other two checks cover the rest. `npm run check:demo` runs the constraint engine and
the move planner over the demo project headlessly, which is how the move planner's
staging deadlock and a walkable-area metric that measured the wrong thing were found.
`npm run check:smoke` drives a real browser through every route and panel. `npm run check`
runs the lot.

## Stack

Next.js 16 (App Router) · React 19 · React Three Fiber and three.js · Zustand with Immer
and Zundo for history · Dexie over IndexedDB · Tailwind CSS v4.

Everything runs locally in the browser. There is no backend, no account, and no upload of
your photographs anywhere. Projects export to JSON.

## Optional AI detection

Boxing furniture by hand takes about a minute and needs no configuration. To have a
vision model propose the boxes instead, set:

```bash
STANZA_VISION_API_KEY=sk-...
STANZA_VISION_BASE_URL=https://api.openai.com/v1   # optional
STANZA_VISION_MODEL=gpt-4o-mini                    # optional
```

The photograph is sent to that endpoint only when you press **Detect with AI**, and the
route accepts any OpenAI-compatible provider, including a local one.

## Map of the source

```
src/lib/geometry     vectors, OBB/SAT collision, polygon clipping, linear algebra
src/lib/vision       line segments, vanishing points, calibration, reconstruction, worker
src/lib/domain       types, furniture category priors, scene resolution
src/lib/constraints  occupancy grid, solar position, evaluation, move planning
src/lib/plan         canvas floor-plan renderer, shared by screen and print
src/lib/store        Zustand studio state with undo/redo
src/lib/db           Dexie schema, demo seed
src/components       capture wizard, studio panels, 3D scene, UI primitives
scripts              ground-truth room renderer, calibration check, demo check, smoke test
```

## Honest limits

Single-image calibration needs a room with visible straight edges and a floor in frame;
a photograph taken flat against one wall has no second vanishing point and will not
calibrate well. When that happens the app says so rather than inventing a number — the
confidence badge is driven by whether the independent focal estimates agree, so a
disagreement shows up as a lower score instead of a confident wrong answer.

Depth of a piece the camera can only see the front of is a prior, not a measurement, and
footprint widths carry the bounding-box bias described above. The inspector lets you
correct any dimension, and a tape measure beats every algorithm here. Segmentation masks
instead of boxes, multi-view fusion, and multi-room adjacency are the next things worth
building.
