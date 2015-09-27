var Phaser = Phaser || {};
var Platformer = Platformer || {};

var style = { font: "32px Arial", fill: "#ff0044" };

Platformer.TiledState = function() {
    "use strict";
    Phaser.State.call(this);
};

Platformer.TiledState.prototype = Object.create(Phaser.State.prototype);
Platformer.TiledState.prototype.constructor = Platformer.TiledState;

Platformer.TiledState.prototype.init = function(level_data) {
    "use strict";
    this.level_data = level_data;

    this.scale.scaleMode = Phaser.ScaleManager.NO_SCALE;
    this.scale.pageAlignHorizontally = true;
    this.scale.pageAlignVertically = true;

    // create map and set tileset
    this.map = this.game.add.tilemap(level_data.map.key);
    this.map.addTilesetImage(this.map.tilesets[0].name, level_data.map.tileset);

    this.ws = new WebSocket("ws://localhost:8080/");
    this.ws.onmessage = this.onMessage.bind(this);
    this.bg = game.add.tileSprite(0, 0, 1024, 576, 'background');

    this.player = 0;

    this.input.onDown.add(this.processInput, this);

    this.paths = {};
    this.visiblePaths = {};
    this.reachOverlays = [];
    this.message = null;
    this.playerText = null;
};

Platformer.TiledState.prototype.create = function() {
    "use strict";
    // create groups
    this.groups = {};
    this.level_data.groups.forEach(function(group_name) {
        this.groups[group_name] = this.game.add.group();
    }, this);

    // create map layers
    this.layers = {};
    this.prefabs = {};
    this.map.layers.forEach(function(layer) {
        this.layers[layer.name] = this.map.createLayer(layer.name, undefined, undefined, this.groups["layers"]);
        var tiles = [];
        layer.data.forEach(function(data_row) { // find tiles used in the layer
            var row = [];
            data_row.forEach(function(tile) {
                row.push(tile.index > 0 ? tile.index : 0);
                this.create_object(tile);
            }, this);
            tiles.push(row);
        }, this);

        if (layer.name == 'objetos') {
            this.state = tiles;
            this.layers[layer.name].visible = false;
        } else if (layer.name == 'walls') {
            this.walls = tiles;
            // FIXME window.x = this.layers[layer.name];
            this.layers[layer.name].position.set(-4, 8)
        }
    }, this);

    // create go button
    this.okButton = this.add.button(900, 0, 'go', function() {
        console.log("paths: ", JSON.stringify(this.paths));
        this.send({ type: "MOVE", move: this.paths });
        var pathGroup = this.groups["paths"];
        Object.keys(this.visiblePaths).forEach(function(key) {
            pathGroup.remove(this.visiblePaths[key])
        }, this);
        this.paths = {};
        this.visiblePaths = {};
        this.okButton.visible = false;
        this.showMessage(WAITING_OTHER_PLAYER);
    }, this, 1, 2);

    this.okButton.visible = false;
    this.showMessage(CONNECTING);

    // resize the world to be the size of the current layer
    this.layers[this.map.layer.name].resizeWorld();
};

Platformer.TiledState.prototype.create_object = function(object) {
    "use strict";
    var position, prefab;
    position = { "x": object.x * this.map.tileHeight, "y": object.y * this.map.tileHeight };
    switch (object.index) {
        case P11:
        case P21:
            prefab = new Platformer.Player(this, position, {
                texture: CHARACTERS[object.index].name,
                group: "characters",
                isP1: object.index == P11
            });
            break;
        case P12:
        case P22:
            prefab = new Platformer.Player(this, position, {
                texture: CHARACTERS[object.index].name,
                group: "characters",
                isP1: object.index == P12
            });
            break;
        case P13:
        case P23:
            prefab = new Platformer.Player(this, position, {
                texture: CHARACTERS[object.index].name,
                group: "characters",
                isP1: object.index == P13
            });
            break;
        case MONEY:
            prefab = new Platformer.Goal(this, position);
            break;
    }
    if (prefab) {
        this.prefabs[object.index] = prefab;
    }
};

Platformer.TiledState.prototype.processInput = function(pointer) {
    console.log("························1");
    var x = Math.floor(pointer.x / this.map.tileWidth);
    var y = Math.floor(pointer.y / this.map.tileHeight);

    var state = this.state[y][x];
    console.log("························2", this.selected, x, y);
    if (!this.selected) {
        // Select the character to move
        var character = CHARACTERS[state];
        console.log("························3", character, character && character.player, this.player);
        if (character && character.player == this.player) {
            this.selected = character;
            this.reachable = [[], [], [], [], [], [], [], [], []];
            this.findReachable(x, y, character.reach);
            for (var y1 = 0; y1 < 9; y1++) {
                for (var x1 = 0; x1 < 16; x1++) {
                    var reach = this.reachable[y1][x1];
                    if (reach) {
                        this.reachOverlays.push(this.add.text(x1 * this.map.tileWidth + 24, y1 * this.map.tileHeight + 16, reach, style));
                    }
                }
            }
        }
    } else {
        // Select target destination
        var reachable = this.reachable[y][x];
        if (reachable) {
            var pathGroup = this.groups["paths"];
            this.path = [];
            this.findPath(x, y);
            var points = this.path.map(function(p) {
                return new Phaser.Point(p[0] * this.map.tileWidth, p[1] * this.map.tileHeight)
            }, this);

            if (this.visiblePaths[this.selected.type]) {
                pathGroup.remove(this.visiblePaths[this.selected.type]);
            }
            if (this.visiblePaths[this.selected.type + "X"]) {
                pathGroup.remove(this.visiblePaths[this.selected.type + "X"]);
            }

            this.visiblePaths[this.selected.type] = this.game.add.rope(32, 32, 'line', null, points, pathGroup);
            this.path.shift();
            this.paths[this.selected.type] = this.path;

            var last = points[points.length - 1];
            this.visiblePaths[this.selected.type + "X"] = this.game.add.image(last.x, last.y, "cross", 0, pathGroup);
        }
        this.selected = null;
        this.reachOverlays.forEach(function(overlay) {
            this.world.remove(overlay);
        }, this);
    }
};

Platformer.TiledState.prototype.showMessage = function(message) {
    this.message = this.add.text(20, 20, message, style);
};

Platformer.TiledState.prototype.onMessage = function(message) {
    console.log("message received:", message);
    message = JSON.parse(message.data);
    switch (message.type) {
        case "START":
            if (message.firstPlayer) {
                this.player = 1;
                this.send({ type: "STATE", state: this.state, walls: this.walls });
                this.okButton.visible = true;
            } else {
                this.player = 2;
            }
            //this.playerText = this.add.text(910, 0, "Player " + this.player, style);
            break;
        case "ACTIONS":
            this.proccessActions(message);
            this.okButton.visible = true;
            break;
        case "STATE":
            this.state = message.state;
            this.okButton.visible = true;
            break;
    }

    if (this.message) {
        this.world.remove(this.message);
        this.message = null;
    }
};

Platformer.TiledState.prototype.proccessActions = function(message) {
    //received: {"type":"ACTIONS","actions":[{"5":{"pos":[1,1],"shoot":false, "die":true},"6":{"pos":[3,3],"shoot":false},"7":{"pos":[5,5]}},{"4":{"pos":[2,2]},"8":{"pos":[4,4]}}]}

    // TODO all this is necessary??
    var tweens = [], shoots = [], dies = [];
    var tweensAux = [], shootsAux = [], diesAux = [];
    var firstTween, firstShoot, firstDie;
    var tweenAux, shootAux, dieAux;

    message.actions.forEach(function(action) {



        console.log("proccessActions: ", action);

        // SHOOT
        Object.keys(action).forEach(function(id) {
            if (action[id].shoot) {
                var shootX = action[id].shoot[0];
                var shootY = action[id].shoot[1];
            }
        }, this);
        // DIE
        Object.keys(action).forEach(function(id) {
            if (action[id].die) {
                var player = this.prefabs[id];
                player.visible = false;
            }
        }, this);
        // MOVE
        Object.keys(action).forEach(function(id) {
            // ver se o player está vivo
            var pos = action[id].pos;
            if (pos) {
                var posX = pos[0];
                var posY = pos[1];

                var player = this.prefabs[id];


                var tween = this.add.tween(player).to({x: (posX * 64), y: (posY * 64)}, 5000, Phaser.Easing.Linear.none);

                var angle = this.calculateAngle(player.x,player.y,(posX*64),(posY*64));

                var tweenAngle = null;

                if(angle != player.angle){
                     tweenAngle = this.add.tween(player).to({angle: angle}, 2000, Phaser.Easing.Linear.none);

                }

                if (tweens[id]) {
                    tweens[id].push(tween);
                } else {
                    tweens[id] = [];
                    tweens[id].push(tween);
                }

                if(tweenAngle) {
                    tweens[id].push(tweenAngle);
                }

            }


        }, this);

    }, this);

    // Chain tween moves.

    tweens.forEach(function(tweenArray) {
        //if (firstTween) {
        //    firstTween = tween[0];
        //}
        tweenArray.forEach(function(tween){

            if(tweenAux){
                tweenAux.chain(tween);
            }

            tweenAux = tween
        },this);

        tweenAux = null;
        tweenArray[0].start();

    },this);


};


Platformer.TiledState.prototype.calculateAngle = function(x,y,xPos,yPos) {

    var angle;

    if (x > xPos) {
        angle = 0;

    } else if (x < xPos) {
        angle = 180;

    }

    if (y > yPos) {
        angle = 90;

    } else if (y < yPos) {
        angle = -90;

    }

    console.log("Angle: ",angle);

    return angle;
};



/////////////////////////////////////////////////////////////

Platformer.TiledState.prototype.send = function(message) {
    this.ws.send(JSON.stringify(message));
};

Platformer.TiledState.prototype.findReachable = function(x, y, reach) {
    if (reach == 0 || x < 0 || y < 0 || x > 15 || y > 8) {
        return;
    }

    if (!this.reachable[y][x] || this.reachable[y][x] < reach) {
        this.reachable[y][x] = reach;
    }

    var wall, state;
    // NORTH
    state = y > 0 && this.state[y - 1][x];
    if (!state || state == 3) {
        wall = y >= 1 && this.walls[y - 1][x];
        if (wall != WALL_S && wall != WALL_SW) {
            this.findReachable(x, y - 1, reach - 1);
        }
    }
    // EAST
    state = x < 15 && this.state[y][x + 1];
    if (!state || state == 3) {
        wall = x < 15 && this.walls[y][x + 1];
        if (wall != WALL_W && wall != WALL_SW) {
            this.findReachable(x + 1, y, reach - 1);
        }
    }
    // SOUTH
    state = y < 8 && this.state[y + 1][x];
    if (!state || state == 3) {
        wall = this.walls[y][x];
        if (wall != WALL_S && wall != WALL_SW) {
            this.findReachable(x, y + 1, reach - 1);
        }
    }
    // WEST
    state = x > 0 && this.state[y][x - 1];
    if (!state || state == 3) {
        wall = this.walls[y][x];
        if (wall != WALL_W && wall != WALL_SW) {
            this.findReachable(x - 1, y, reach - 1);
        }
    }
};

Platformer.TiledState.prototype.findPath = function(x, y) {
    this.path.unshift([x, y]);
    var reach = this.reachable[y][x];

    // NORTH
    if (y > 0 && this.reachable[y - 1][x] > reach) {
        wall = this.walls[y - 1][x];
        if (wall != WALL_S && wall != WALL_SW) {
            return this.findPath(x, y - 1);
        }
    }
    // EAST
    if (x < 15 && this.reachable[y][x + 1] > reach) {
        wall = this.walls[y][x + 1];
        if (wall != WALL_W && wall != WALL_SW) {
            return this.findPath(x + 1, y);
        }
    }
    // SOUTH
    if (y < 8 && this.reachable[y + 1][x] > reach) {
        wall = this.walls[y][x];
        if (wall != WALL_S && wall != WALL_SW) {
            return this.findPath(x, y + 1);
        }
    }
    // WEST
    if (x > 0 && this.reachable[y][x - 1] > reach) {
        wall = this.walls[y][x];
        if (wall != WALL_W && wall != WALL_SW) {
            return this.findPath(x - 1, y);
        }
    }
};

Platformer.TiledState.prototype.restart_level = function() {
    "use strict";
    this.game.state.restart(true, false, this.level_data);
};
