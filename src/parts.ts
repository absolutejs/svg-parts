// A part is a set of shapes with a name and a colour.
//
// The model this replaces made a part out of a hex value, so two unrelated
// shapes that happened to share black could never be recoloured separately,
// and a design drawn with forty shades had forty "parts". Here a part owns
// specific nodes; what colour they currently are is incidental.

import { PAINT_ATTRS, paintOf, type SvgDocument, type SvgNode } from './parse';

export type Part = {
	/** Stable id, used as the key in a colour map. */
	id: string;
	/** What the shop calls it: "outline", "the star", "background". */
	name: string;
	/** Nodes this part owns, by `SvgNode.id`. */
	nodeIds: string[];
	/** The colour it was drawn in — the default when nobody picks one. */
	color: string | null;
	/** Whether this part's colour is the stroke rather than the fill. */
	paint: 'fill' | 'stroke';
};

export type PartModel = {
	parts: Part[];
	/** Nodes no part claims. They still draw; they just can't be recoloured. */
	unassigned: string[];
	version: 1;
};

const slug = (value: string, fallback: string) => {
	const cleaned = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-|-$/gu, '');

	return cleaned || fallback;
};

/** Give a part an id nothing else in the model is using. */
const uniqueId = (wanted: string, taken: Set<string>) => {
	if (!taken.has(wanted)) return wanted;
	let suffix = 2;
	while (taken.has(`${wanted}-${suffix}`)) suffix += 1;

	return `${wanted}-${suffix}`;
};

const COLOR_WORDS: Record<string, string> = {
	'#000000': 'black',
	'#ffffff': 'white'
};

/** A first guess at a name, so nothing is called "part 3" unless it has to
 *  be: the colour if we have a word for it, otherwise its place in the
 *  drawing. */
const guessName = (color: string | null, position: number, total: number) => {
	if (color && COLOR_WORDS[color]) return COLOR_WORDS[color];
	if (total === 1) return 'the whole design';
	if (position === 0) return 'background';
	if (position === total - 1) return 'detail';

	return `part ${position + 1}`;
};

const paintedNodes = (doc: SvgDocument, attr: string) =>
	doc.nodes.filter((node) => paintOf(node, attr)?.startsWith('#') === true);

/**
 * The model a flat design arrives with: one part per distinct colour. This is
 * exactly what the old colour-keyed system did, which makes it the migration
 * path — read an existing design, get the same parts, then split them.
 */
export const partsFromColors = (doc: SvgDocument): PartModel => {
	const byColor = new Map<
		string,
		{ nodeIds: string[]; paint: Part['paint'] }
	>();
	PAINT_ATTRS.forEach((attr) => {
		paintedNodes(doc, attr).forEach((node) => {
			const color = paintOf(node, attr);
			if (color === null) return;
			const key = `${attr}:${color}`;
			const held = byColor.get(key) ?? {
				nodeIds: [],
				paint: attr as Part['paint']
			};
			if (!held.nodeIds.includes(node.id)) held.nodeIds.push(node.id);
			byColor.set(key, held);
		});
	});
	const taken = new Set<string>();
	const entries = [...byColor.entries()];
	const parts = entries.map(([key, held], position) => {
		const color = key.slice(key.indexOf(':') + 1);
		const name = guessName(color, position, entries.length);
		const id = uniqueId(slug(name, `part-${position + 1}`), taken);
		taken.add(id);

		return { color, id, name, nodeIds: held.nodeIds, paint: held.paint };
	});

	return { parts, unassigned: unassignedIn(doc, parts), version: 1 };
};

/** Every drawable node no part owns. */
export const unassignedIn = (doc: SvgDocument, parts: Part[]) => {
	const claimed = new Set(parts.flatMap((part) => part.nodeIds));

	return doc.nodes
		.filter((node) => !claimed.has(node.id))
		.map((node) => node.id);
};

/** One part holding everything — the starting point for a design somebody
 *  wants to colour as a single mark. */
export const oneWholePart = (doc: SvgDocument, name = 'the whole design') => {
	const nodeIds = doc.nodes.map((node) => node.id);
	const color = doc.nodes
		.map((node) => paintOf(node, 'fill'))
		.find((paint) => paint?.startsWith('#') === true);

	return {
		parts: [
			{
				color: color ?? null,
				id: slug(name, 'whole'),
				name,
				nodeIds,
				paint: 'fill' as const
			}
		],
		unassigned: [],
		version: 1
	} satisfies PartModel;
};

/** Which paints the picked shapes actually carry — a selection with no
 *  stroke should never be offered "outline". */
export const availablePaints = (doc: SvgDocument, nodeIds: string[]) =>
	PAINT_ATTRS.filter((attr) =>
		doc.nodes.some(
			(node) =>
				nodeIds.includes(node.id) &&
				paintOf(node, attr)?.startsWith('#') === true
		)
	) as Part['paint'][];

export type GroupInput = {
	/** Nodes to pull into the new part. */
	nodeIds: string[];
	name: string;
	paint?: Part['paint'];
};

/**
 * Pull nodes out of whatever parts hold them and into a new one. This is the
 * whole point of the model: the shop selects two shapes and says "that is the
 * crest", regardless of what colour either of them is.
 */
export const groupPart = (
	doc: SvgDocument,
	model: PartModel,
	input: GroupInput
): PartModel => {
	const wanted = new Set(
		input.nodeIds.filter((id) => doc.nodes.some((node) => node.id === id))
	);
	if (wanted.size === 0) return model;
	const paint = input.paint ?? 'fill';
	const taken = new Set(model.parts.map((part) => part.id));
	const id = uniqueId(
		slug(input.name, `part-${model.parts.length + 1}`),
		taken
	);
	const color =
		doc.nodes
			.filter((node) => wanted.has(node.id))
			.map((node) => paintOf(node, paint))
			.find((value) => value?.startsWith('#') === true) ?? null;
	const kept = model.parts
		.map((part) =>
			// A shape can be in a fill part and a stroke part at once — they
			// are different colours on the same shape. Grouping a fill only
			// takes it out of other fill parts.
			part.paint === paint
				? {
						...part,
						nodeIds: part.nodeIds.filter(
							(nodeId) => !wanted.has(nodeId)
						)
					}
				: part
		)
		// A part that lost every shape it had is not a part any more.
		.filter((part) => part.nodeIds.length > 0);
	const parts = [
		...kept,
		{ color, id, name: input.name, nodeIds: [...wanted], paint }
	];

	return { parts, unassigned: unassignedIn(doc, parts), version: 1 };
};

/** Rename a part without touching what it holds. */
export const renamePart = (
	model: PartModel,
	partId: string,
	name: string
): PartModel => ({
	...model,
	parts: model.parts.map((part) =>
		part.id === partId ? { ...part, name } : part
	)
});

/** Drop a part; its shapes go back to being unassigned and keep the colours
 *  they were drawn in. */
export const ungroupPart = (
	doc: SvgDocument,
	model: PartModel,
	partId: string
): PartModel => {
	const parts = model.parts.filter((part) => part.id !== partId);

	return { parts, unassigned: unassignedIn(doc, parts), version: 1 };
};

/** Which part owns a node, if any — what a canvas asks on hover. */
export const partOfNode = (model: PartModel, nodeId: string) =>
	model.parts.find((part) => part.nodeIds.includes(nodeId)) ?? null;

/** The colours a design shows with no customer choices applied. */
export const defaultColors = (model: PartModel) =>
	Object.fromEntries(
		model.parts
			.filter((part) => part.color !== null)
			.map((part) => [part.id, part.color as string])
	);

/** A part model as the old colour-keyed map, for code that still speaks it. */
export const colorMapOf = (
	model: PartModel,
	colors: Record<string, string>
) => {
	const map: Record<string, string> = {};
	model.parts.forEach((part) => {
		const wanted = colors[part.id];
		if (wanted && part.color) map[part.color] = wanted;
	});

	return map;
};

export type { SvgDocument, SvgNode };
