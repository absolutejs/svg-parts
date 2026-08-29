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

// Names a person would use for a colour. A part called "part 3" is a part
// nobody has named; one called "gold" is at least true, and the shop can
// still call it "the crest".
const COLOR_WORDS: [string, [number, number, number]][] = [
	['black', [0, 0, 0]],
	['white', [255, 255, 255]],
	['grey', [128, 128, 128]],
	['red', [214, 40, 40]],
	['maroon', [128, 0, 32]],
	['orange', [244, 140, 6]],
	['gold', [245, 180, 0]],
	['yellow', [250, 237, 39]],
	['green', [45, 138, 62]],
	['forest', [20, 83, 45]],
	['teal', [0, 128, 128]],
	['blue', [36, 87, 197]],
	['navy', [16, 42, 94]],
	['sky', [125, 188, 232]],
	['purple', [107, 63, 160]],
	['pink', [232, 106, 146]],
	['brown', [110, 72, 43]],
	['cream', [245, 238, 220]]
];

const rgbOf = (color: string): [number, number, number] | null => {
	const hex = color.replace('#', '');
	if (hex.length < 6) return null;

	return [
		Number.parseInt(hex.slice(0, 2), 16),
		Number.parseInt(hex.slice(2, 4), 16),
		Number.parseInt(hex.slice(4, 6), 16)
	];
};

/** The everyday word for a colour — the nearest of a small, honest list. */
export const colorWord = (color: string | null) => {
	const rgb = color ? rgbOf(color) : null;
	if (!rgb) return null;
	const [nearest] = COLOR_WORDS.map(
		([word, [red, green, blue]]) =>
			[
				word,
				(rgb[0] - red) ** 2 +
					(rgb[1] - green) ** 2 +
					(rgb[2] - blue) ** 2
			] as const
	).sort((left, right) => left[1] - right[1]);

	return nearest?.[0] ?? null;
};

/** A first guess at a name. Every part gets a true one — the colour it is
 *  drawn in, or what it does — so no design arrives with parts nobody has
 *  named. */
const guessName = (
	color: string | null,
	paint: Part['paint'],
	taken: Set<string>
) => {
	const word = colorWord(color);
	const base =
		paint === 'stroke'
			? `${word ?? 'the'} outline`
			: (word ?? 'the whole design');
	if (!taken.has(base)) return base;
	let suffix = 2;
	while (taken.has(`${base} ${suffix}`)) suffix += 1;

	return `${base} ${suffix}`;
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
	const names = new Set<string>();
	const entries = [...byColor.entries()];
	const parts = entries.map(([key, held], position) => {
		const color = key.slice(key.indexOf(':') + 1);
		const name = guessName(color, held.paint, names);
		names.add(name);
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

/** Put a part somewhere else in the order. Parts are listed to the customer
 *  in this order, and paint order is rarely the order a person would read
 *  them in — "outline" belongs under the thing it outlines. */
export const movePart = (
	model: PartModel,
	partId: string,
	offset: number
): PartModel => {
	const from = model.parts.findIndex((part) => part.id === partId);
	if (from === -1 || offset === 0) return model;
	const to = Math.min(Math.max(from + offset, 0), model.parts.length - 1);
	if (to === from) return model;
	const parts = [...model.parts];
	const [moved] = parts.splice(from, 1);
	if (!moved) return model;
	parts.splice(to, 0, moved);

	return { ...model, parts };
};

/** The whole order at once — what a drag-and-drop list hands back. Ids it
 *  does not mention keep their relative order at the end. */
export const reorderParts = (
	model: PartModel,
	orderedIds: string[]
): PartModel => {
	const byId = new Map(model.parts.map((part) => [part.id, part]));
	const wanted = orderedIds
		.map((id) => byId.get(id))
		.filter((part): part is Part => part !== undefined);
	const rest = model.parts.filter((part) => !orderedIds.includes(part.id));

	return { ...model, parts: [...wanted, ...rest] };
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
