// @absolutejs/svg-parts — read an SVG as named, recolourable parts.
//
// A part is a set of shapes with a name and a colour, not a hex value. That
// distinction is the whole library: two unrelated shapes drawn in the same
// black can be separate parts, and a design drawn in forty shades does not
// have forty "parts" for a customer to wade through.
//
// The first slice is the model and the rewrite. A selection canvas rides on
// top of `withPartIds`, and nothing here needs a browser.

export * from './apply';
export * from './parse';
export * from './parts';
