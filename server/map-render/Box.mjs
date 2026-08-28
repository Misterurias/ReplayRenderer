// Vendored from github.com/LEGENDBOSS123/BonkMapEditor (Box.mjs), unmodified.
import { Shape } from "./Shape.mjs";

export class Box extends Shape {
    constructor() {
        super();
        this.type = Shape.TYPE.BOX;
        this.width = 100;
        this.height = 100;
        this.angle = 0;
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
        ctx.fillStyle = `#${fixture.color.toString(16).padStart(6, '0')}`;
        ctx.strokeStyle = `rgba(255, 255, 255, 0.8)`;
        ctx.lineWidth = 3;
        isCapZone ? ctx.strokeRect(-this.width / 2, -this.height / 2, this.width, this.height) : ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
        ctx.restore();
    }

    toJSON() {
        const json = super.toJSON();
        json.w = this.width;
        json.h = this.height;
        json.a = this.angle;
        return json;
    }

    static fromJSON(json) {
        const box = new Box();
        box.fromJSON(json);
        box.width = json.w;
        box.height = json.h;
        box.angle = json.a;
        return box;
    }
}
