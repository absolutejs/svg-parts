// Picking shapes off the artwork.
//
// The part model says which shapes belong together; this is how somebody
// says so. Click a shape to take it, shift-click to add another, then the
// caller groups the selection into a named part. Everything not selected is
// dimmed rather than outlined — an outline on a shape that is itself an
// outline reads as noise.

import { useMemo, type CSSProperties, type MouseEvent } from 'react';
import { withPartIds } from './apply';
import { parseSvg, stripScripts } from './parse';
import { partOfNode, type PartModel } from './parts';

export type PartCanvasProps = {
	className?: string;
	/** Node ids currently picked. */
	selection: string[];
	/** A shape was clicked. `additive` is true when shift or meta was held. */
	onSelect: (nodeId: string, additive: boolean) => void;
	model: PartModel;
	style?: CSSProperties;
	/** The artwork. Scripts and handlers are stripped before it is rendered. */
	svg: string;
};

const STYLES = `
.svgparts-stage svg { width: 100%; height: 100%; display: block; }
.svgparts-stage [data-node] { cursor: pointer; }
.svgparts-stage.picking [data-node] { opacity: 0.3; transition: opacity 0.1s ease; }
.svgparts-stage.picking [data-node][data-picked='1'] { opacity: 1; }
.svgparts-stage [data-node]:hover { opacity: 1; }
`;

/**
 * The artwork, clickable shape by shape. Controlled: the caller owns the
 * selection, so grouping, undo and keyboard handling stay where the rest of
 * the editing lives.
 */
export const PartCanvas = ({
	className,
	model,
	onSelect,
	selection,
	style,
	svg
}: PartCanvasProps) => {
	const markup = useMemo(() => {
		const doc = parseSvg(stripScripts(svg));
		// Every shape needs a handle, including the ones no part owns yet —
		// otherwise they could never be picked into their first part.
		const loose = {
			parts: [
				...model.parts,
				{
					color: null,
					id: '',
					name: '',
					nodeIds: doc.nodes
						.filter(
							(node) =>
								!model.parts.some((part) =>
									part.nodeIds.includes(node.id)
								)
						)
						.map((node) => node.id),
					paint: 'fill' as const
				}
			],
			unassigned: [],
			version: 1 as const
		};

		return withPartIds(doc, loose);
	}, [svg, model]);

	const picked = useMemo(() => new Set(selection), [selection]);
	const withPicked = useMemo(
		() =>
			[...picked].reduce(
				(html, nodeId) =>
					html.replace(
						`data-node="${nodeId}"`,
						`data-node="${nodeId}" data-picked="1"`
					),
				markup
			),
		[markup, picked]
	);

	const click = (event: MouseEvent<HTMLDivElement>) => {
		const target = (event.target as Element | null)?.closest('[data-node]');
		const nodeId = target?.getAttribute('data-node');
		if (nodeId) onSelect(nodeId, event.shiftKey || event.metaKey);
	};

	return (
		<div
			className={`svgparts-stage${picked.size > 0 ? ' picking' : ''}${
				className ? ` ${className}` : ''
			}`}
			onClick={click}
			onKeyDown={undefined}
			role="presentation"
			style={style}
		>
			<style>{STYLES}</style>
			<div
				// The markup is stripped of scripts and handlers above.
				dangerouslySetInnerHTML={{ __html: withPicked }}
			/>
		</div>
	);
};

/** What the shapes somebody has picked currently belong to — the sentence a
 *  canvas puts under itself ("2 shapes · part 2, detail"). */
export const selectionSummary = (model: PartModel, selection: string[]) => {
	const names = [
		...new Set(
			selection
				.map((nodeId) => partOfNode(model, nodeId)?.name)
				.filter((name): name is string => Boolean(name))
		)
	];

	return {
		count: selection.length,
		parts: names
	};
};
