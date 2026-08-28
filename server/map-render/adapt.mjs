// server/map-render/adapt.mjs
//
// Bridges two schemas:
//   1. maps.mapdata / replay startingState.physics (what our DB actually stores)
//   2. BonkMapEditor's Shape/Fixture/Body/Physics classes (what can draw it)
//
// Two real discrepancies handled here, both confirmed against sample data
// (not guessed):
//
//  a) Body schema: our bodies nest static settings under `body.s` (type, n,
//     fric, fricp, re, de, ld, ad, fr, bu, f_c, f_p, f_1..4) while runtime
//     fields (p, a, av, lv, cf, fx, fz) stay top-level. BonkMapEditor's
//     Body.fromJSON expects everything flat. flattenBody() merges them.
//
//  b) Polygon transform: box2d polygon fixtures store vertices already in the
//     body's local space, and bonk's real client renderer never re-applies a
//     shape-level c/a/s on top for the "po" case — confirmed by checking real
//     shapes in our data, which carry non-identity c/a/s (e.g. a=90°, s=0.2)
//     that would visibly misplace the polygon if BonkMapEditor's Polygon.draw
//     applied them as authored. neutralizePolygon() zeroes c/a/s to identity
//     so Polygon.draw's transform becomes a no-op, leaving only the body's
//     translate/rotate in effect — matching the real renderer. Box and Circle
//     shapes are NOT touched: their own c/a genuinely do compose with the
//     body transform (verified: body.p + rotate(body.a) * shape.c lands on
//     plausible in-game coordinates).
import { Shape } from "./Shape.mjs";
import { Box } from "./Box.mjs";
import { Circle } from "./Circle.mjs";
import { Polygon } from "./Polygon.mjs";
import { Fixture } from "./Fixture.mjs";
import { Body } from "./Body.mjs";
import { Physics } from "./Physics.mjs";
import { CapZone } from "./CapZone.mjs";

function flattenBody(json) {
    const s = json.s ?? {};
    return {
        type: s.type ?? json.type ?? "s",
        n: s.n ?? json.n ?? "Unnamed",
        p: json.p ?? [0, 0],
        a: json.a ?? 0,
        fric: s.fric ?? 0.3,
        fricp: s.fricp ?? false,
        re: s.re ?? 0.8,
        de: s.de ?? 0.3,
        lv: json.lv ?? [0, 0],
        av: json.av ?? 0,
        ld: s.ld ?? 0,
        ad: s.ad ?? 0,
        fr: s.fr ?? false,
        bu: s.bu ?? false,
        cf: json.cf ?? { x: 0, y: 0, w: true, ct: 0 },
        fx: json.fx ?? [],
        f_c: s.f_c ?? 1,
        f_p: s.f_p ?? true,
        f_1: s.f_1 ?? true,
        f_2: s.f_2 ?? true,
        f_3: s.f_3 ?? true,
        f_4: s.f_4 ?? true,
        fz: json.fz ?? { on: false, x: 0, y: 0, t: 0, d: true, p: true, a: true, cf: 0 },
    };
}

function neutralizePolygon(json) {
    return { ...json, c: [0, 0], a: 0, s: 1 };
}

function buildShape(json) {
    switch (json?.type) {
        case Shape.TYPE.BOX:
            return Box.fromJSON(json);
        case Shape.TYPE.CIRCLE:
            return Circle.fromJSON(json);
        case Shape.TYPE.POLYGON:
            return Polygon.fromJSON(neutralizePolygon(json));
        default:
            return null;
    }
}

// physicsJson: the raw `physics` object from maps.mapdata (shapes, fixtures,
// bodies, bro, ppm — joints are ignored, see Physics.mjs). capZonesJson: the
// raw `capZones` array (from the same map row, or a replay's startingState).
export function buildMap(physicsJson, capZonesJson = []) {
    const physics = new Physics();
    physics.partsPerMeter = physicsJson?.ppm ?? 12;
    physics.shapes = (physicsJson?.shapes ?? []).map(buildShape);
    physics.fixtures = (physicsJson?.fixtures ?? []).map(Fixture.fromJSON);
    physics.bodies = (physicsJson?.bodies ?? []).map(b => Body.fromJSON(flattenBody(b)));
    physics.bodyRenderOrder = physicsJson?.bro?.length
        ? [...physicsJson.bro]
        : physics.bodies.map((_, i) => i);

    const capZones = (capZonesJson ?? []).map(CapZone.fromJSON);

    return { physics, capZones };
}
