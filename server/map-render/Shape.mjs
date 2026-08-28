// Vendored from github.com/LEGENDBOSS123/BonkMapEditor (Shape.mjs), unmodified.
// Base class for the three shape types bonk.io's renderer draws: box, circle,
// polygon. See adapt.mjs for the one place we deviate from upstream behavior
// (polygon transform neutralization) and why.
export class Shape {
    static TYPE = {
        BOX: "bx",
        CIRCLE: "ci",
        POLYGON: "po"
    }

    constructor() {
        this.type = null;
        this.position = {
            x: 0,
            y: 0
        };
        this.shrink = false;
    }

    toJSON() {
        return {
            type: this.type,
            c: [this.position.x, this.position.y],
            sk: this.shrink
        }
    }

    fromJSON(json){
        this.type = json.type;
        this.position = {
            x: json.c[0],
            y: json.c[1]
        };
        this.shrink = json.sk;
    }
}
