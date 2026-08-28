// Vendored from github.com/LEGENDBOSS123/BonkMapEditor (Circle.mjs), unmodified.
import { Shape } from "./Shape.mjs";

export class Circle extends Shape {
    constructor() {
        super();
        this.type = Shape.TYPE.CIRCLE;
        this.radius = 50;
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
        ctx.fillStyle = `#${fixture.color.toString(16).padStart(6, '0')}`;
        ctx.strokeStyle = `rgba(255, 255, 255, 0.8)`;
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        isCapZone ? ctx.stroke() : ctx.fill();
        ctx.restore();
    }

    toJSON() {
        const json = super.toJSON();
        json.r = this.radius;
        return json;
    }

    static fromJSON(json) {
        const circle = new Circle();
        circle.fromJSON(json);
        circle.radius = json.r;
        return circle;
    }
}
