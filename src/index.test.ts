import { describe, expect, test } from 'bun:test';
import {
	applyParts,
	availablePaints,
	colorMapOf,
	colorWord,
	defaultColors,
	groupPart,
	movePart,
	oneWholePart,
	paintOf,
	paletteOf,
	parseSvg,
	partOfNode,
	partsFromColors,
	recolor,
	renamePart,
	reorderParts,
	stripScripts,
	ungroupPart,
	withPartIds
} from './index';
import { nodesInRect, selectionSummary } from './react';

// A crest: two shapes drawn in the same black that mean different things,
// which is exactly what a colour-keyed model cannot tell apart.
const CREST = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
	<title>Crest</title>
	<g id="badge">
		<path id="shield" d="M10 10h80v80H10z" fill="#161310" />
		<circle id="dot" cx="50" cy="50" r="20" fill="#161310" />
	</g>
	<path id="ribbon" d="M0 80h100v10H0z" fill="#c8102e" stroke="#FFF" />
	<rect id="hidden" x="0" y="0" width="1" height="1" fill="none" />
</svg>`;

describe('parseSvg', () => {
	test('reads the drawable shapes in paint order, with their groups', () => {
		const doc = parseSvg(CREST);
		expect(doc.nodes.map((node) => node.id)).toEqual([
			'shield',
			'dot',
			'ribbon',
			'hidden'
		]);
		expect(doc.nodes[0]?.groups).toEqual(['badge']);
		expect(doc.nodes[2]?.groups).toEqual([]);
		expect(doc.viewBox).toBe('0 0 100 100');
	});

	test('a shape with no id still gets one that survives a re-parse', () => {
		const markup = '<svg><path d="M0 0h5v5H0z" fill="#fff"/></svg>';
		const first = parseSvg(markup).nodes[0]?.id;
		expect(first).toBeTruthy();
		expect(parseSvg(markup).nodes[0]?.id).toBe(first as string);
	});

	test('reads paint from an attribute or from style, style winning', () => {
		const doc = parseSvg(
			'<svg><rect fill="#00f" style="fill:#F00;stroke:#0f0"/></svg>'
		);
		const node = doc.nodes[0];
		expect(node && paintOf(node, 'fill')).toBe('#ff0000');
		expect(node && paintOf(node, 'stroke')).toBe('#00ff00');
	});

	test('shorthand hex is one comparable form, and none is left alone', () => {
		const doc = parseSvg(
			'<svg><rect fill="#FFF"/><rect fill="none"/></svg>'
		);
		expect(doc.nodes[0] && paintOf(doc.nodes[0], 'fill')).toBe('#ffffff');
		expect(doc.nodes[1] && paintOf(doc.nodes[1], 'fill')).toBe('none');
	});

	test('the palette is every painted colour, once, in paint order', () => {
		expect(paletteOf(parseSvg(CREST))).toEqual([
			'#161310',
			'#c8102e',
			'#ffffff'
		]);
	});
});

describe('partsFromColors', () => {
	test('gives one part per colour — the model this replaces', () => {
		const model = partsFromColors(parseSvg(CREST));
		expect(model.parts).toHaveLength(3);
		expect(model.parts[0]?.nodeIds).toEqual(['shield', 'dot']);
		expect(model.parts[0]?.color).toBe('#161310');
		expect(model.parts[2]?.paint).toBe('stroke');
	});

	test('names every part for what it is, never "part 3"', () => {
		const model = partsFromColors(parseSvg(CREST));
		// #161310 is near-black, #c8102e is a red, and the white one is an
		// outline rather than a fill.
		expect(model.parts.map((part) => part.name)).toEqual([
			'black',
			'red',
			'white outline'
		]);
	});

	test('two parts of the same colour are told apart', () => {
		const twice = parseSvg(
			'<svg><rect fill="#d62828"/><circle stroke="#d62828"/><path stroke="#c02020"/></svg>'
		);
		expect(partsFromColors(twice).parts.map((part) => part.name)).toEqual([
			'red',
			'red outline',
			'red outline 2'
		]);
	});

	test('says the everyday word for a colour', () => {
		expect(colorWord('#161310')).toBe('black');
		expect(colorWord('#f5b400')).toBe('gold');
		expect(colorWord('#2457c5')).toBe('blue');
		expect(colorWord(null)).toBeNull();
	});

	test('a shape painted none belongs to nothing', () => {
		const model = partsFromColors(parseSvg(CREST));
		expect(model.unassigned).toEqual(['hidden']);
	});
});

describe('groupPart', () => {
	test('splits two shapes that share a colour — the point of the model', () => {
		const doc = parseSvg(CREST);
		const model = groupPart(doc, partsFromColors(doc), {
			name: 'The dot',
			nodeIds: ['dot']
		});
		const dot = partOfNode(model, 'dot');
		const shield = partOfNode(model, 'shield');
		expect(dot?.name).toBe('The dot');
		expect(shield?.id).not.toBe(dot?.id);
		// Both were black; recolouring one leaves the other alone.
		const painted = recolor(CREST, model, { 'the-dot': '#ffd700' });
		expect(painted).toContain(
			'id="dot" cx="50" cy="50" r="20" fill="#ffd700"'
		);
		expect(painted).toContain(
			'id="shield" d="M10 10h80v80H10z" fill="#161310"'
		);
	});

	test('a part that loses every shape stops existing', () => {
		const doc = parseSvg(CREST);
		const model = groupPart(doc, partsFromColors(doc), {
			name: 'Everything black',
			nodeIds: ['shield', 'dot']
		});
		expect(
			model.parts.some(
				(part) =>
					part.color === '#161310' && part.id !== 'everything-black'
			)
		).toBe(false);
	});

	test('ids never collide, however things are named', () => {
		const doc = parseSvg(CREST);
		let model = groupPart(doc, partsFromColors(doc), {
			name: 'Mark',
			nodeIds: ['shield']
		});
		model = groupPart(doc, model, { name: 'Mark', nodeIds: ['dot'] });
		const ids = model.parts.map((part) => part.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('ignores node ids that are not in the document', () => {
		const doc = parseSvg(CREST);
		const model = partsFromColors(doc);
		expect(
			groupPart(doc, model, { name: 'Ghost', nodeIds: ['nope'] })
		).toBe(model);
	});
});

describe('applying colour', () => {
	test('rewrites only the shapes a part owns, byte for byte otherwise', () => {
		const doc = parseSvg(CREST);
		const model = partsFromColors(doc);
		const out = applyParts(doc, {
			colors: { [model.parts[1]?.id ?? '']: '#0000ff' },
			model
		});
		expect(out).toContain('<title>Crest</title>');
		expect(out).toContain('id="ribbon" d="M0 80h100v10H0z" fill="#0000ff"');
		expect(out).toContain(
			'id="shield" d="M10 10h80v80H10z" fill="#161310"'
		);
	});

	test('paints into style when that is where the colour lives', () => {
		const markup =
			'<svg><rect id="r" style="fill:#f00;stroke:#000"/></svg>';
		const doc = parseSvg(markup);
		const model = partsFromColors(doc);
		const red = model.parts.find((part) => part.color === '#ff0000');
		expect(
			applyParts(doc, { colors: { [red?.id ?? '']: '#00ff00' }, model })
		).toContain('style="fill:#00ff00;stroke:#000"');
	});

	test('adds the attribute when the shape had none', () => {
		const markup = '<svg><path id="p" d="M0 0h1v1H0z"/></svg>';
		const doc = parseSvg(markup);
		const model = { ...oneWholePart(doc, 'mark') };
		expect(recolor(markup, model, { mark: '#123456' })).toContain(
			'<path fill="#123456" id="p"'
		);
	});

	test('no colours picked means the document comes back untouched', () => {
		expect(recolor(CREST, partsFromColors(parseSvg(CREST)), {})).toBe(
			CREST
		);
	});
});

describe('the rest of the model', () => {
	test('renaming keeps what the part holds', () => {
		const doc = parseSvg(CREST);
		const model = partsFromColors(doc);
		const id = model.parts[0]?.id ?? '';
		const renamed = renamePart(model, id, 'Outline');
		expect(renamed.parts[0]?.name).toBe('Outline');
		expect(renamed.parts[0]?.nodeIds).toEqual(['shield', 'dot']);
	});

	test('ungrouping puts its shapes back to unassigned', () => {
		const doc = parseSvg(CREST);
		const model = partsFromColors(doc);
		const after = ungroupPart(doc, model, model.parts[0]?.id ?? '');
		expect(after.parts).toHaveLength(2);
		expect(after.unassigned).toContain('shield');
		expect(after.unassigned).toContain('dot');
	});

	test('one whole part owns everything drawable', () => {
		const doc = parseSvg(CREST);
		const model = oneWholePart(doc);
		expect(model.parts[0]?.nodeIds).toHaveLength(4);
		expect(model.unassigned).toEqual([]);
	});

	test('default colours are what the artwork was drawn in', () => {
		const model = partsFromColors(parseSvg(CREST));
		expect(Object.values(defaultColors(model))).toEqual([
			'#161310',
			'#c8102e',
			'#ffffff'
		]);
	});

	test('speaks the old colour map for code that still needs it', () => {
		const model = partsFromColors(parseSvg(CREST));
		const id = model.parts[0]?.id ?? '';
		expect(colorMapOf(model, { [id]: '#ffd700' })).toEqual({
			'#161310': '#ffd700'
		});
	});

	test('marks up the shapes so a canvas can hit-test them', () => {
		const doc = parseSvg(CREST);
		const model = groupPart(doc, partsFromColors(doc), {
			name: 'The dot',
			nodeIds: ['dot']
		});
		const marked = withPartIds(doc, model);
		expect(marked).toContain('data-part="the-dot" data-node="dot"');
		expect(marked).not.toContain('data-part="the-dot" data-node="shield"');
	});
});

describe('stripScripts', () => {
	test('takes out what a browser must never run', () => {
		const nasty =
			'<svg><script>alert(1)</script><rect onclick="alert(2)" fill="#fff"/><a xlink:href="javascript:alert(3)"/><foreignObject><b/></foreignObject></svg>';
		const clean = stripScripts(nasty);
		expect(clean).not.toContain('<script');
		expect(clean).not.toContain('onclick');
		expect(clean).not.toContain('javascript:');
		expect(clean).not.toContain('foreignObject');
		expect(clean).toContain('fill="#fff"');
	});

	test('leaves ordinary artwork alone', () => {
		expect(stripScripts(CREST)).toBe(CREST);
	});
});

describe('selectionSummary', () => {
	test('says how many shapes and what they belong to', () => {
		const doc = parseSvg(CREST);
		const model = groupPart(doc, partsFromColors(doc), {
			name: 'The dot',
			nodeIds: ['dot']
		});
		expect(selectionSummary(model, ['dot', 'shield'])).toEqual({
			count: 2,
			parts: ['The dot', 'black']
		});
	});

	test('shapes in no part contribute nothing to say', () => {
		const doc = parseSvg(CREST);
		expect(selectionSummary(partsFromColors(doc), ['hidden'])).toEqual({
			count: 1,
			parts: []
		});
	});
});

describe('a shape with both a fill and a stroke', () => {
	// The shield: one path carrying a blue fill and a black outline. They are
	// two colours on one shape, so they are two parts.
	const SHIELD = `<svg><path id="body" d="M0 0h9v9H0z" fill="#2457c5" stroke="#161310"/><rect id="bar" x="1" y="4" width="7" height="1" fill="#f5b400"/></svg>`;

	test('is in a fill part and a stroke part at once', () => {
		const model = partsFromColors(parseSvg(SHIELD));
		const holding = model.parts.filter((part) =>
			part.nodeIds.includes('body')
		);
		expect(holding.map((part) => part.paint).sort()).toEqual([
			'fill',
			'stroke'
		]);
	});

	test('grouping its fill leaves its outline alone', () => {
		const doc = parseSvg(SHIELD);
		const model = groupPart(doc, partsFromColors(doc), {
			name: 'Shield body',
			nodeIds: ['body']
		});
		const stroke = model.parts.find((part) => part.paint === 'stroke');
		expect(stroke?.nodeIds).toContain('body');
		const painted = recolor(SHIELD, model, {
			'shield-body': '#ff0000'
		});
		expect(painted).toContain('fill="#ff0000"');
		expect(painted).toContain('stroke="#161310"');
	});

	test('only offers the paints the selection actually has', () => {
		const doc = parseSvg(SHIELD);
		expect(availablePaints(doc, ['body'])).toEqual(['fill', 'stroke']);
		expect(availablePaints(doc, ['bar'])).toEqual(['fill']);
	});
});

describe('ordering parts', () => {
	const model = () => partsFromColors(parseSvg(CREST));

	test('moves a part up the list the customer reads', () => {
		const before = model();
		const last = before.parts[2]?.id ?? '';
		const after = movePart(before, last, -2);
		expect(after.parts[0]?.id).toBe(last);
		expect(after.parts).toHaveLength(before.parts.length);
	});

	test('will not walk a part off either end', () => {
		const before = model();
		const first = before.parts[0]?.id ?? '';
		expect(movePart(before, first, -3).parts[0]?.id).toBe(first);
		expect(movePart(before, first, 99).parts[2]?.id).toBe(first);
	});

	test('an unknown part or a zero move changes nothing', () => {
		const before = model();
		expect(movePart(before, 'nope', 1)).toBe(before);
		expect(movePart(before, before.parts[0]?.id ?? '', 0)).toBe(before);
	});

	test('takes a whole order, keeping anything it did not mention', () => {
		const before = model();
		const [one, two, three] = before.parts.map((part) => part.id);
		const after = reorderParts(before, [three ?? '', one ?? '']);
		expect(after.parts.map((part) => part.id)).toEqual([three, one, two]);
	});
});

describe('marquee hit test', () => {
	const box = (id: string, left: number, top: number) => ({
		id,
		rect: { bottom: top + 10, left, right: left + 10, top }
	});

	test('takes every shape the rectangle touches', () => {
		const boxes = [box('a', 0, 0), box('b', 20, 0), box('c', 40, 40)];
		expect(
			nodesInRect(boxes, { bottom: 15, left: 0, right: 25, top: 0 })
		).toEqual(['a', 'b']);
	});

	test('a rectangle touching nothing selects nothing', () => {
		expect(
			nodesInRect([box('a', 0, 0)], {
				bottom: 200,
				left: 100,
				right: 200,
				top: 100
			})
		).toEqual([]);
	});

	test('edges that only graze do not count', () => {
		expect(
			nodesInRect([box('a', 0, 0)], {
				bottom: 20,
				left: 10,
				right: 20,
				top: 0
			})
		).toEqual([]);
	});
});

describe('paint inherited from a group', () => {
	// A hoop frame: the colour lives on the <g>, and the shapes inside say
	// nothing about their own paint.
	const HOOP = `<svg><g fill="none" stroke="#161310" stroke-width="6"><circle id="ring" cx="120" cy="120" r="58"/><line id="cross" x1="120" y1="28" x2="120" y2="212"/></g></svg>`;

	test('a shape inside a painted group is painted', () => {
		const doc = parseSvg(HOOP);
		const ring = doc.nodes[0];
		expect(ring && paintOf(ring, 'stroke')).toBe('#161310');
		expect(ring && paintOf(ring, 'fill')).toBe('none');
	});

	test('so the design has parts rather than none', () => {
		const model = partsFromColors(parseSvg(HOOP));
		expect(model.parts).toHaveLength(1);
		expect(model.parts[0]?.name).toBe('black outline');
		expect(model.parts[0]?.nodeIds).toEqual(['ring', 'cross']);
	});

	test('the element wins over what it stands inside', () => {
		const doc = parseSvg(
			'<svg><g stroke="#161310"><circle id="c" stroke="#c8102e"/></g></svg>'
		);
		expect(doc.nodes[0] && paintOf(doc.nodes[0], 'stroke')).toBe('#c8102e');
	});

	test('recolouring writes onto the shape, not the group', () => {
		const doc = parseSvg(HOOP);
		const model = partsFromColors(doc);
		const painted = applyParts(doc, {
			colors: { [model.parts[0]?.id ?? '']: '#2457c5' },
			model
		});
		expect(painted).toContain('<circle stroke="#2457c5" id="ring"');
		expect(painted).toContain('<g fill="none" stroke="#161310"');
	});
});
