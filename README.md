# @absolutejs/svg-parts

Read an SVG as named, recolourable **parts** — a part is a set of shapes, not
a hex value.

```ts
import {
	parseSvg,
	partsFromColors,
	groupPart,
	recolor
} from '@absolutejs/svg-parts';

const doc = parseSvg(markup);

// A flat design arrives as one part per colour — the same model a
// colour-keyed recolour gives you, so nothing has to be re-entered.
let model = partsFromColors(doc);

// Then split it the way the artwork actually reads.
model = groupPart(doc, model, { name: 'crest', nodeIds: ['n3', 'n4'] });

// Colour by part id. Shapes another part owns are untouched, even if they
// were drawn in the same colour.
const painted = recolor(markup, model, { crest: '#c8102e' });
```

## Why

Recolouring a flat SVG by substituting hex values repaints every shape that
shares that hex. Two unrelated shapes drawn in black can never be separated,
and a design with forty shades presents forty "parts" to a customer. This
library gives shapes stable ids, lets you group them into named parts, and
rewrites one attribute on one element at a time — the rest of the document is
returned byte for byte.

## What's here

|                                                                         |                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `parseSvg(markup)`                                                      | Drawable elements in paint order, each with a stable id, its group ancestry and the byte range of its opening tag. |
| `paletteOf(doc)`                                                        | Every distinct painted colour, in paint order.                                                                     |
| `partsFromColors(doc)`                                                  | One part per colour — the migration path from a colour-keyed model.                                                |
| `oneWholePart(doc)`                                                     | Everything as a single part.                                                                                       |
| `groupPart(doc, model, { name, nodeIds })`                              | Pull shapes into a new named part, out of whatever held them.                                                      |
| `renamePart` / `ungroupPart` / `partOfNode`                             | The rest of the model edits.                                                                                       |
| `applyParts(doc, { model, colors })` / `recolor(markup, model, colors)` | Paint by part id.                                                                                                  |
| `withPartIds(doc, model)`                                               | The same markup with `data-part` / `data-node`, for a canvas to hit-test.                                          |
| `colorMapOf(model, colors)`                                             | The old colour→colour map, for code that still speaks it.                                                          |

No DOM, no XML parser dependency, no browser needed.

## Status

`0.1.0-beta` — the parser and the part model. A React selection canvas is the
next slice; drawing tools are deliberately not in scope (Illustrator exists).
