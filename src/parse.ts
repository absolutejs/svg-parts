// Reading an SVG well enough to talk about its shapes.
//
// Not a DOM and not a validator: a flat, ordered list of the drawable
// elements in a document, each with a stable id, so the rest of the library
// can say "these three shapes are the outline" without anybody having to
// think in hex values. Runs anywhere — no browser, no XML parser dependency.

/** An element that puts marks on the canvas. Everything else (defs, title,
 *  metadata) is structure we keep but never assign to a part. */
export const DRAWABLE_TAGS = [
	'circle',
	'ellipse',
	'image',
	'line',
	'path',
	'polygon',
	'polyline',
	'rect',
	'text',
	'tspan',
	'use'
];

/** Where a colour can live on an element. */
export const PAINT_ATTRS = ['fill', 'stroke'];

export type SvgNode = {
	/** Stable within a document: the element's own id when it has one,
	 *  otherwise its position — so a part written today still points at the
	 *  same shape tomorrow. */
	id: string;
	tag: string;
	attrs: Record<string, string>;
	/** Index into the source order, which is paint order. */
	index: number;
	/** The enclosing <g> ids, outermost first. */
	groups: string[];
	/** Byte range of the element's opening tag in the source. */
	start: number;
	end: number;
	/** Whether this element draws anything. */
	drawable: boolean;
};

export type SvgDocument = {
	markup: string;
	nodes: SvgNode[];
	/** viewBox as written, when the root has one. */
	viewBox: string | null;
};

const TAG_RE = /<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gu;
const ATTR_RE = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gu;

const readAttrs = (raw: string) => {
	const attrs: Record<string, string> = {};
	for (const match of raw.matchAll(ATTR_RE)) {
		const name = match[1];
		if (!name) continue;
		attrs[name] = match[3] ?? match[4] ?? match[5] ?? '';
	}

	return attrs;
};

/** A colour written in any of the forms SVG allows, in one comparable shape.
 *  `none`, `currentColor` and url(#gradient) references stay as they are —
 *  they are not colours anyone can pick. */
export const normalizePaint = (value: string) => {
	const paint = value.trim();
	if (!paint.startsWith('#')) return paint.toLowerCase();
	const hex = paint.slice(1).toLowerCase();
	if (hex.length === 3 || hex.length === 4)
		return `#${hex
			.slice(0, 3)
			.split('')
			.map((char) => `${char}${char}`)
			.join('')}`;

	return `#${hex.slice(0, 6)}`;
};

/** The paint on an element, taking the `style` attribute into account —
 *  `style="fill:#f00"` beats `fill="#00f"`, the way a browser paints it. */
export const paintOf = (node: SvgNode, attr: string): string | null => {
	const style = node.attrs.style;
	if (style) {
		const found = new RegExp(
			`(?:^|;)\\s*${attr}\\s*:\\s*([^;]+)`,
			'u'
		).exec(style);
		if (found?.[1]) return normalizePaint(found[1]);
	}
	const direct = node.attrs[attr];

	return direct === undefined ? null : normalizePaint(direct);
};

/**
 * Read a document into its drawable elements. Elements keep their source
 * order (which is paint order), their group ancestry, and the byte range of
 * their opening tag so a rewrite can be surgical rather than a re-serialize.
 */
export const parseSvg = (markup: string): SvgDocument => {
	const nodes: SvgNode[] = [];
	const open: { id: string; tag: string }[] = [];
	let index = 0;
	let auto = 0;
	let viewBox: string | null = null;

	for (const match of markup.matchAll(TAG_RE)) {
		const whole = match[0];
		const tag = (match[1] ?? '').toLowerCase();
		const raw = match[2] ?? '';
		const selfClosing = match[3] === '/';
		const start = match.index ?? 0;
		if (whole.startsWith('</')) {
			const last = open[open.length - 1];
			if (last?.tag === tag) open.pop();
			continue;
		}
		const attrs = readAttrs(raw);
		if (tag === 'svg' && viewBox === null)
			viewBox = attrs.viewBox ?? attrs.viewbox ?? null;
		const drawable = DRAWABLE_TAGS.includes(tag);
		if (drawable) {
			auto += 1;
			nodes.push({
				attrs,
				drawable,
				end: start + whole.length,
				groups: open.map((entry) => entry.id),
				id: attrs.id ?? `n${auto}`,
				index,
				start,
				tag
			});
			index += 1;
		}
		// Only a <g> is a group. The root <svg> is the document, and listing
		// it as an ancestor of everything says nothing.
		if (!selfClosing && tag === 'g') {
			auto += 1;
			open.push({ id: attrs.id ?? `g${auto}`, tag });
		}
	}

	return { markup, nodes, viewBox };
};

/** Every distinct colour actually painted in the document, in paint order —
 *  the old way of seeing an SVG, kept because it is how a flat design still
 *  arrives. */
export const paletteOf = (doc: SvgDocument) => {
	const seen: string[] = [];
	doc.nodes.forEach((node) => {
		PAINT_ATTRS.forEach((attr) => {
			const paint = paintOf(node, attr);
			if (paint?.startsWith('#') && !seen.includes(paint))
				seen.push(paint);
		});
	});

	return seen;
};
