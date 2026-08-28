// Vendored from github.com/LEGENDBOSS123/BonkMapEditor (Body.mjs), unmodified.
export class Body {

    static FORCE_DIRECTION = {
        ABSOLUTE: 0,
        RELATIVE: 1
    }

    static TYPE = {
        STATIONARY: "s",
        FREE_MOVING: "d",
        KINEMATIC: "k"
    }

    static FORCEZONE_TYPE = {
        ABSOLUTE: 0,
        RELATIVE: 1,
        CENTER_PUSH: 2,
        CENTER_PULL: 3
    }

    constructor() {
        this.type = Body.TYPE.STATIONARY;
        this.name = "Unnamed";
        this.position = {
            x: 0,
            y: 0
        };
        this.angle = 0;
        this.friction = 0.5;
        this.frictionPlayers = false;
        this.bounciness = 0.8;
        this.density = 0.3;

        this.startSpeed = {
            x: 0,
            y: 0
        };
        this.startSpin = 0;
        this.linearDrag = 0;
        this.spinDrag = 0;
        this.fixedRotation = false;

        this.antiTunneling = false;

        this.applyForce = {
            x: 0,
            y: 0
        };
        this.forceDirection = Body.FORCE_DIRECTION.ABSOLUTE;
        this.applyTorque = 0;

        this.fixtureIndices = [];

        this.collideGroup = 1;
        this.collideWithPlayers = true;
        this.collideWithGroup1 = true;
        this.collideWithGroup2 = true;
        this.collideWithGroup3 = true;
        this.collideWithGroup4 = true;

        this.forceZone = {
            on: false,
            type: Body.FORCEZONE_TYPE.ABSOLUTE,
            x: 0,
            y: 0,
            forceMagnitude: 0,
            pushPlayers: true,
            pushPlatforms: true,
            pushArrows: true
        }
    }

    draw(ctx, map){
        ctx.save();
        ctx.translate(this.position.x, this.position.y);
        ctx.rotate(this.angle);
        for(const fi of this.fixtureIndices){
            const fixture = map.physics.fixtures[fi];
            if(fixture){
                fixture.draw(ctx, map);
            }
        }
        ctx.restore();
    }

    static fromJSON(json){
        const body = new Body();
        body.type = json.type;
        body.name = json.n;
        body.position = {
            x: json.p[0],
            y: json.p[1]
        };
        body.angle = json.a;
        body.friction = json.fric;
        body.frictionPlayers = json.fricp;
        body.bounciness = json.re;
        body.density = json.de;
        body.startSpeed = {
            x: json.lv[0],
            y: json.lv[1]
        };
        body.startSpin = json.av;
        body.linearDrag = json.ld;
        body.spinDrag = json.ad;
        body.fixedRotation = json.fr;
        body.antiTunneling = json.bu;
        body.applyForce = {
            x: json.cf.x,
            y: json.cf.y
        };
        body.forceDirection = json.cf.w;
        body.applyTorque = json.cf.ct;
        body.fixtureIndices = [...json.fx];
        body.collideGroup = json.f_c;
        body.collideWithPlayers = json.f_p;
        body.collideWithGroup1 = json.f_1;
        body.collideWithGroup2 = json.f_2;
        body.collideWithGroup3 = json.f_3;
        body.collideWithGroup4 = json.f_4;
        body.forceZone = {
            on: json.fz.on,
            type: json.fz.t,
            x: json.fz.x,
            y: json.fz.y,
            forceMagnitude: json.fz.cf,
            pushPlayers: json.fz.d,
            pushPlatforms: json.fz.p,
            pushArrows: json.fz.a
        };
        return body;
    }
}
