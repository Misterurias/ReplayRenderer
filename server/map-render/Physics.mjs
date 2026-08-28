// Trimmed from BonkMapEditor's Physics.mjs (github.com/LEGENDBOSS123/BonkMapEditor).
//
// Upstream's Physics.fromJSON() also parses `joints` (rotation/rod/spring/gear/
// follows-path), which requires vendoring 5 more classes. Physics.draw() never
// reads joints — they're invisible, functional-only — so for a static map
// thumbnail we skip them entirely and build shapes/fixtures/bodies directly in
// adapt.mjs instead of using upstream's fromJSON. draw() and
// updateBodyRenderOrder() below are otherwise unmodified.
export class Physics {
    constructor() {
        this.shapes = [];
        this.fixtures = [];
        this.bodies = [];
        this.bodyRenderOrder = [];
        this.partsPerMeter = 12;
    }

    updateBodyRenderOrder(){
        this.bodyRenderOrder = this.bodies.map((_, i) => i);
    }

    draw(ctx, map){
        for (let i = this.bodyRenderOrder.length - 1; i >= 0; i--) {
            const body = this.bodies[this.bodyRenderOrder[i]];
            if(body){
                body.draw(ctx, map);
            }
        }
    }
}
