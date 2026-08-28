// Vendored from github.com/LEGENDBOSS123/BonkMapEditor (CapZone.mjs), unmodified.
export class CapZone {

    static TYPE = {
        NORMAL: 1,
        RED: 2,
        BLUE: 3,
        GREEN: 4,
        YELLOW: 5
    }

    constructor() {
        this.name = "Cap Zone";
        this.type = CapZone.TYPE.NORMAL;
        this.captureTime = 3;
        this.shapeIndex = -1;
    }

    static fromJSON(json){
        const capZone = new CapZone();
        capZone.name = json.n;
        capZone.type = json.ty;
        capZone.captureTime = json.l;
        capZone.shapeIndex = json.i;
        return capZone;
    }
}
