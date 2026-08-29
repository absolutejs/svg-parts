import { describe, expect, test } from 'bun:test';
import {
	applyParts,
	colorMapOf,
	defaultColors,
	groupPart,
	oneWholePart,
	paintOf,
	paletteOf,
	parseSvg,
	partOfNode,
	partsFromColors,
	recolor,
	renamePart,
	stripScripts,
	ungroupPart,
	withPartIds
} from './index';
import { selectionSummary } from './react';

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

	test('names what it can rather than numbering everything', () => {
		const model = partsFromColors(parseSvg(CREST));
		// #161310 is not #000000, so it gets a positional name; pure white
		// is named for what it is.
		expect(model.parts[0]?.name).toBe('background');
		expect(model.parts[2]?.name).toBe('white');
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
			parts: ['The dot', 'background']
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
