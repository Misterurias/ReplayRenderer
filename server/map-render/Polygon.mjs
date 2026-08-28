// Vendored from github.com/LEGENDBOSS123/BonkMapEditor (Polygon.mjs), unmodified.
//
// IMPORTANT: this class applies this.position / this.angle / this.scale as a
// transform before drawing `vertices` — correct for BonkMapEditor's own
// authoring format, where a polygon is edited as local vertices + a
// separate placement transform.
//
// Runtime map data (maps.mapdata / replay startingState.physics) does NOT
// follow that convention: box2d polygon fixtures store vertices already in
// the *body's* local space, and bonk's real client renderer (MapRenderer.build,
// confirmed from decompiled source) never applies a shape-level c/a/s on top
// of them for the "po" case. If we fed this class real runtime data as-is,
// non-identity c/a/s values (which director/editor round-tripping leaves on
// many polygons) would double-transform and misplace the shape.
//
// adapt.mjs handles this by neutralizing c/a/s to identity (c=[0,0], a=0,
// s=1) on polygon shapes before calling Polygon.fromJSON, so this class's
// transform becomes a no-op and `vertices` draws exactly where bonk's own
// renderer would put it — relative to the body's translate/rotate applied
// one level up in Body.draw(). Do not remove that neutralization step.
import { Shape } from "./Shape.mjs";

export class Polygon extends Shape {
    constructor() {
        super();
        this.type = Shape.TYPE.POLYGON;
        this.angle = 0;
        this.scale = 1;
        this.vertices = [];
    }

    draw(ctx, map, fixture) {
        let isCapZone = false;
        for (const cz of map.capZones) {
            if (cz.shapeIndex == fixture.shapeIndex) {
                isCapZone = true;
                break;
            }
        }
        ctx.save();
        ctx.translate(this.position.x, this.position.y);
        ctx.rotate(this.angle);
        ctx.scale(this.scale, this.scale);
        ctx.fillStyle = `#${fixture.color.toString(16).padStart(6, '0')}`;
        ctx.strokeStyle = `rgba(255, 255, 255, 0.8)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (this.vertices.length > 0) {
            ctx.moveTo(this.vertices[0].x, this.vertices[0].y);
            for (let i = 1; i < this.vertices.length; i++) {
                ctx.lineTo(this.vertices[i].x, this.vertices[i].y);
            }
            ctx.closePath();
            isCapZone ? ctx.stroke() : ctx.fill();
        }
        ctx.restore();
    }

    addVertex(x, y) {
        this.vertices.push({ x, y });
    }

    toJSON() {
        const json = super.toJSON();
        json.a = this.angle;
        json.s = this.scale;
        json.v = this.vertices.map(v => ([v.x, v.y]));
        return json;
    }

    static fromJSON(json) {
        const polygon = new Polygon();
        polygon.fromJSON(json);
        polygon.angle = json.a;
        polygon.scale = json.s;
        polygon.vertices = (json.v || []).map(v => ({ x: v[0], y: v[1] }));
        return polygon;
    }
}
