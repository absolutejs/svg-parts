// Picking shapes off the artwork.
//
// The part model says which shapes belong together; this is how somebody
// says so. Click a shape to take it, shift-click to add another, then the
// caller groups the selection into a named part. Everything not selected is
// dimmed rather than outlined — an outline on a shape that is itself an
// outline reads as noise.

import {
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent,
	type PointerEvent
} from 'react';
import { withPartIds } from './apply';
import { parseSvg, stripScripts } from './parse';
import { partOfNode, type PartModel } from './parts';

/** A rectangle in viewport coordinates. */
export type Rect = { bottom: number; left: number; right: number; top: number };

/** Shapes whose box overlaps the dragged rectangle. Pure, so the hit test is
 *  testable without a browser. */
export const nodesInRect = (
	boxes: { id: string; rect: Rect }[],
	marquee: Rect
) =>
	boxes
		.filter(
			({ rect }) =>
				rect.left < marquee.right &&
				rect.right > marquee.left &&
				rect.top < marquee.bottom &&
				rect.bottom > marquee.top
		)
		.map(({ id }) => id);

/** Below this a drag is a click that wobbled, not a marquee. */
const DRAG_SLOP_PX = 4;

export type PartCanvasProps = {
	className?: string;
	/** Node ids currently picked. */
	selection: string[];
	/** A shape was clicked. `additive` is true when shift or meta was held. */
	onSelect: (nodeId: string, additive: boolean) => void;
	/** A rectangle was dragged over these shapes. Falls back to repeated
	 *  `onSelect` calls when not given. */
	onSelectMany?: (nodeIds: string[], additive: boolean) => void;
	model: PartModel;
	style?: CSSProperties;
	/** The artwork. Scripts and handlers are stripped before it is rendered. */
	svg: string;
};

const STYLES = `
.svgparts-stage { position: relative; user-select: none; touch-action: none; }
.svgparts-stage svg { width: 100%; height: 100%; display: block; }
.svgparts-stage [data-node] { cursor: pointer; }
.svgparts-stage.picking [data-node] { opacity: 0.3; transition: opacity 0.1s ease; }
.svgparts-stage.picking [data-node][data-picked='1'] { opacity: 1; }
.svgparts-stage [data-node]:hover { opacity: 1; }
.svgparts-marquee { position: fixed; border: 1px solid currentColor; background: currentColor; opacity: 0.14; pointer-events: none; }
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
	onSelectMany,
	selection,
	style,
	svg
}: PartCanvasProps) => {
	const stage = useRef<HTMLDivElement | null>(null);
	const from = useRef<{ additive: boolean; x: number; y: number } | null>(
		null
	);
	const [marquee, setMarquee] = useState<Rect | null>(null);
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
		// A click that ended a drag has already been answered by the marquee.
		if (marquee) return;
		const target = (event.target as Element | null)?.closest('[data-node]');
		const nodeId = target?.getAttribute('data-node');
		if (nodeId) onSelect(nodeId, event.shiftKey || event.metaKey);
	};

	const rectOf = (x: number, y: number) => {
		const start = from.current;
		if (!start) return null;

		return {
			bottom: Math.max(start.y, y),
			left: Math.min(start.x, x),
			right: Math.max(start.x, x),
			top: Math.min(start.y, y)
		};
	};

	const down = (event: PointerEvent<HTMLDivElement>) => {
		from.current = {
			additive: event.shiftKey || event.metaKey,
			x: event.clientX,
			y: event.clientY
		};
	};

	const move = (event: PointerEvent<HTMLDivElement>) => {
		const start = from.current;
		if (!start) return;
		const far =
			Math.abs(event.clientX - start.x) > DRAG_SLOP_PX ||
			Math.abs(event.clientY - start.y) > DRAG_SLOP_PX;
		if (!(far || marquee)) return;
		setMarquee(rectOf(event.clientX, event.clientY));
	};

	const up = (event: PointerEvent<HTMLDivElement>) => {
		const start = from.current;
		from.current = null;
		if (!(start && marquee)) return;
		const box = rectOf(event.clientX, event.clientY) ?? marquee;
		const found = stage.current?.querySelectorAll('[data-node]');
		const boxes = Array.from(found ?? []).map((element) => ({
			id: element.getAttribute('data-node') ?? '',
			rect: element.getBoundingClientRect()
		}));
		const hit = nodesInRect(boxes, box);
		// Clearing the marquee after the click handler would re-open it, so
		// the state is dropped on the next frame instead.
		window.setTimeout(() => setMarquee(null), 0);
		if (hit.length === 0) return;
		if (onSelectMany) {
			onSelectMany(hit, start.additive);

			return;
		}
		hit.forEach((nodeId, index) =>
			onSelect(nodeId, start.additive || index > 0)
		);
	};

	return (
		<div
			className={`svgparts-stage${picked.size > 0 ? ' picking' : ''}${
				className ? ` ${className}` : ''
			}`}
			onClick={click}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
			ref={stage}
			role="presentation"
			style={style}
		>
			<style>{STYLES}</style>
			{marquee && (
				<div
					className="svgparts-marquee"
					style={{
						height: marquee.bottom - marquee.top,
						left: marquee.left,
						top: marquee.top,
						width: marquee.right - marquee.left
					}}
				/>
			)}
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
