// server/map-render/renderMapThumbnailSvg.mjs
//
// Renders a map thumbnail as real SVG markup instead of a rasterized
// image (the earlier @napi-rs/canvas + webp approach). Bonk maps are flat-
// colored boxes/circles/polygons with no textures or gradients, so they're a
// perfect fit for vector output: an SVG stays mathematically sharp at any
// display size or device pixel ratio, unlike a fixed-resolution raster image
// that has to be upscaled by the browser and gets soft/blurry the moment its
// CSS size or the viewer's DPR exceeds the resolution it was rendered at.
//
// Framing is identical to renderMapThumbnail.mjs's fixed-viewport model
// (bonk's own ThumbMaker always renders the fixed 730x500 game viewport, not
// a bounding-box fit to content — see that file's header for the full
// reasoning and how it was confirmed against bonk's deobfuscated source and
// real replay data). Here that just means: every physics coordinate is
// multiplied by the map's own `ppm` and placed directly into a fixed
// `viewBox="0 0 730 500"` — no separate canvas-resolution decision to make
// at all, since SVG has no native resolution to begin with.
//
// mapData: { physics, capZones } — the parsed JSON already stored in
// maps.mapdata (or a replay's startingState, same shape).
import { buildMap } from "./adapt.mjs";
import { Shape } from "./Shape.mjs";

// Confirmed from bonk.io's real renderer (GameRenderer.createGradientBackground
// in the deobfuscated client): the backdrop behind every map is a fixed
// top-to-bottom gradient (#3b536b -> #2c3e50) drawn as standard game chrome —
// it's not stored per-map data at all, so every map uses this exact same
// gradient. The earlier flat "#102033" was an unsourced guess.
const BG_TOP = "#3b536b";
const BG_BOTTOM = "#2c3e50";
const GAME_WIDTH = 730;
const GAME_HEIGHT = 500;
const STROKE_WIDTH = 3; // matches BonkMapEditor's Box/Circle/Polygon draw() lineWidth

function colorHex(packedRgb) {
    return `#${(packedRgb >>> 0 & 0xffffff).toString(16).padStart(6, "0")}`;
}

function isCapZoneShape(map, shapeIndex) {
    return map.capZones.some((cz) => cz.shapeIndex === shapeIndex);
}

// Confirmed directly from bonk.io's real renderer (MapRenderer.build() in
// the deobfuscated client, not BonkMapEditor's editor-only styling which
// always outlines every shape for editing visibility): ordinary fixtures get
// ONLY beginFill(fixture.color) — no stroke at all. A white lineStyle
// (3 * scaleRatio, 0xFFFFFF, 1) is applied ONLY when the shape is a cap
// zone, paired with a separate `capFill` graphic that fills in proportion to
// live capture progress (doCapZone: size scales with `progress / length`,
// colored by whichever team is currently capturing). A static thumbnail has
// no capture in progress, so that fill would render at ~0 size regardless —
// leaving just the white outline, no interior fill, which is what this
// reproduces.
function shapeStyle(fill, isCap) {
    return isCap
        ? `fill="none" stroke="#ffffff" stroke-width="${STROKE_WIDTH}"`
        : `fill="${fill}" stroke="none"`;
}

function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function renderMapThumbnailSvg(mapData) {
    const map = buildMap(mapData?.physics, mapData?.capZones);
    const ppm = mapData?.physics?.ppm || map.physics.partsPerMeter || 12;

    const elements = [];

    // Same draw order as Physics.draw(): bodyRenderOrder, reversed.
    for (let i = map.physics.bodyRenderOrder.length - 1; i >= 0; i--) {
        const body = map.physics.bodies[map.physics.bodyRenderOrder[i]];
        if (!body) continue;

        const bx = body.position.x * ppm;
        const by = body.position.y * ppm;
        const bAngleDeg = (body.angle * 180) / Math.PI;

        for (const fi of body.fixtureIndices) {
            const fixture = map.physics.fixtures[fi];
            const shape = fixture && map.physics.shapes[fixture.shapeIndex];
            if (!shape) continue;

            const fill = colorHex(fixture.color);
            const isCap = isCapZoneShape(map, fixture.shapeIndex);
            const style = shapeStyle(fill, isCap);
            const bodyTransform = `translate(${bx} ${by}) rotate(${bAngleDeg})`;

            if (shape.type === Shape.TYPE.BOX) {
                const w = shape.width * ppm, h = shape.height * ppm;
                const sx = shape.position.x * ppm, sy = shape.position.y * ppm;
                const sAngleDeg = (shape.angle * 180) / Math.PI;
                elements.push(
                    `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" ` +
                    `transform="${bodyTransform} translate(${sx} ${sy}) rotate(${sAngleDeg})" ${style} />`
                );
            } else if (shape.type === Shape.TYPE.CIRCLE) {
                const r = shape.radius * ppm;
                const sx = shape.position.x * ppm, sy = shape.position.y * ppm;
                elements.push(
                    `<circle cx="0" cy="0" r="${r}" ` +
                    `transform="${bodyTransform} translate(${sx} ${sy})" ${style} />`
                );
            } else if (shape.type === Shape.TYPE.POLYGON) {
                if (shape.vertices.length === 0) continue;
                const pts = shape.vertices.map((v) => `${v.x * ppm},${v.y * ppm}`).join(" ");
                elements.push(
                    `<polygon points="${pts}" transform="${bodyTransform}" ${style} />`
                );
            }
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GAME_WIDTH} ${GAME_HEIGHT}" preserveAspectRatio="xMidYMid slice">` +
        `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${escapeAttr(BG_TOP)}" />` +
        `<stop offset="1" stop-color="${escapeAttr(BG_BOTTOM)}" />` +
        `</linearGradient></defs>` +
        `<rect x="0" y="0" width="${GAME_WIDTH}" height="${GAME_HEIGHT}" fill="url(#bg)" />` +
        elements.join("") +
        `</svg>`;
}
