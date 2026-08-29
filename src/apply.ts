// Writing the colours back.
//
// Recolouring by string substitution — the way a flat design has always been
// handled — repaints every shape that shares a hex. This paints the shapes a
// part actually owns, by rewriting one attribute on one element at a time and
// leaving every other byte of the document alone.

import { paintOf, parseSvg, type SvgDocument, type SvgNode } from './parse';
import type { Part, PartModel } from './parts';

const ATTR_RE = (attr: string) =>
	new RegExp(`\\s${attr}\\s*=\\s*("[^"]*"|'[^']*')`, 'u');

const STYLE_RE = (attr: string) =>
	new RegExp(`((?:^|;)\\s*${attr}\\s*:\\s*)([^;]+)`, 'u');

/** Set one paint attribute on one opening tag, however the element wrote it:
 *  in `style`, in an attribute, or not at all. */
const paintTag = (tag: string, attr: string, color: string) => {
	const styleMatch = ATTR_RE('style').exec(tag);
	if (styleMatch?.[1]) {
		const style = styleMatch[1].slice(1, -1);
		if (STYLE_RE(attr).test(style)) {
			const next = style.replace(STYLE_RE(attr), `$1${color}`);

			return tag.replace(
				styleMatch[0],
				` style="${next.replace(/"/gu, '&quot;')}"`
			);
		}
	}
	if (ATTR_RE(attr).test(tag))
		return tag.replace(ATTR_RE(attr), ` ${attr}="${color}"`);

	// Nothing to replace: add it, just inside the tag name.
	return tag.replace(/^<([a-zA-Z][\w:-]*)/u, `<$1 ${attr}="${color}"`);
};

export type ApplyInput = {
	/** partId → colour. Anything missing keeps the colour it was drawn in. */
	colors: Record<string, string>;
	model: PartModel;
};

/**
 * The document with each part's colour applied to the shapes it owns. Byte
 * ranges come from the parse, so tags are rewritten in place from the end
 * backwards and every earlier offset stays valid.
 */
export const applyParts = (doc: SvgDocument, input: ApplyInput) => {
	const byNode = new Map<string, { color: string; paint: Part['paint'] }>();
	input.model.parts.forEach((part) => {
		const color = input.colors[part.id];
		if (!color) return;
		part.nodeIds.forEach((nodeId) =>
			byNode.set(nodeId, { color, paint: part.paint })
		);
	});
	if (byNode.size === 0) return doc.markup;

	const edits = doc.nodes
		.filter((node) => byNode.has(node.id))
		.sort((left, right) => right.start - left.start);

	return edits.reduce((markup, node) => {
		const wanted = byNode.get(node.id);
		if (!wanted) return markup;
		const tag = markup.slice(node.start, node.end);

		return (
			markup.slice(0, node.start) +
			paintTag(tag, wanted.paint, wanted.color) +
			markup.slice(node.end)
		);
	}, doc.markup);
};

/** Same thing from raw markup, for a caller that has not parsed yet. */
export const recolor = (
	markup: string,
	model: PartModel,
	colors: Record<string, string>
) => applyParts(parseSvg(markup), { colors, model });

/**
 * The document with `data-part` on every assigned shape, so a canvas can hit
 * -test a click without carrying the node list alongside the markup.
 */
export const withPartIds = (doc: SvgDocument, model: PartModel) => {
	const byNode = new Map<string, string>();
	model.parts.forEach((part) =>
		part.nodeIds.forEach((nodeId) => {
			// A shape can be in a fill part and a stroke part; the first one
			// that claims it is the one a click reports, so the attribute is
			// stable rather than whichever part happened to be last.
			if (!byNode.has(nodeId)) byNode.set(nodeId, part.id);
		})
	);
	const edits = doc.nodes
		.filter((node) => byNode.has(node.id))
		.sort((left, right) => right.start - left.start);

	return edits.reduce((markup, node) => {
		const partId = byNode.get(node.id);
		if (partId === undefined) return markup;
		const tag = markup.slice(node.start, node.end);
		const next = tag.replace(
			/^<([a-zA-Z][\w:-]*)/u,
			`<$1 data-part="${partId}" data-node="${node.id}"`
		);

		return markup.slice(0, node.start) + next + markup.slice(node.end);
	}, doc.markup);
};

/** What a part looks like right now: its colour, or the colour of the first
 *  shape it owns. */
export const partColor = (
	doc: SvgDocument,
	part: Part,
	colors: Record<string, string> = {}
) => {
	const chosen = colors[part.id];
	if (chosen) return chosen;
	if (part.color) return part.color;
	const owned = doc.nodes.find((node: SvgNode) =>
		part.nodeIds.includes(node.id)
	);

	return owned ? paintOf(owned, part.paint) : null;
};
