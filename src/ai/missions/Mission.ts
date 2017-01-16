import {Operation} from "../operations/Operation";
import {Empire} from "../Empire";
import {SpawnGroup} from "../SpawnGroup";
import {HeadCountOptions, TransportAnalysis} from "../../interfaces";
import {DESTINATION_REACHED, ROOMTYPE_SOURCEKEEPER, ROOMTYPE_ALLEY} from "../../config/constants";
import {helper} from "../../helpers/helper";
import {Agent} from "./Agent";
import {empire} from "../../helpers/loopHelper";
export abstract class Mission {

    flag: Flag;
    empire: Empire;
    memory: any;
    spawnGroup: SpawnGroup;
    sources: Source[];
    room: Room;
    name: string;
    operation: Operation;
    allowSpawn: boolean;
    hasVision: boolean;
    waypoints: Flag[];
    partnerPairing: {[role: string]: Creep[]} = {};
    distanceToSpawn: number;

    constructor(operation: Operation, name: string, allowSpawn: boolean = true) {
        this.name = name;
        this.flag = operation.flag;
        this.room = operation.room;
        this.empire = operation.empire;
        this.spawnGroup = operation.spawnGroup;
        this.sources = operation.sources;
        if (!operation.memory[name]) operation.memory[name] = {};
        this.memory = operation.memory[name];
        this.allowSpawn = allowSpawn;
        this.operation = operation;
        if (this.room) this.hasVision = true;
        // initialize memory to be used by this mission
        if (!this.memory.spawn) this.memory.spawn = {};
        if (!this.memory.hc) this.memory.hc = {};
        if (operation.waypoints && operation.waypoints.length > 0) {
            this.waypoints = operation.waypoints;
        }
    }

    /**
     * Init Phase - Used to initialize values for the following phases
     */
    public abstract initMission();

    /**
     * RoleCall Phase - Used to find creeps and spawn any extra that are needed
     */
    public abstract roleCall();

    /**
     * MissionAction Phase - Primary phase for world-changing functions like creep.harvest(), tower.attack(), etc.
     */
    public abstract missionActions();

    /**
     * Finish Phase - Do any remaining work that needs to happen after the other phases
     */
    public abstract finalizeMission();

    /**
     * Invalidate Cache Phase - Do any housekeeping that might need to be done
     */
    public abstract invalidateMissionCache();

    public setBoost(activateBoost: boolean) {
        let oldValue = this.memory.activateBoost;
        this.memory.activateBoost = activateBoost;
        return `changing boost activation for ${this.name} in ${this.operation.name} from ${oldValue} to ${activateBoost}`;
    }

    public setMax(max: number) {
        let oldValue = this.memory.max;
        this.memory.max = max;
        return `changing max creeps for ${this.name} in ${this.operation.name} from ${oldValue} to ${max}`;
    }

    public setSpawnGroup(spawnGroup: SpawnGroup) {
        this.spawnGroup = spawnGroup;
    }

    public invalidateSpawnDistance() {
        if (this.memory.distanceToSpawn) {
            console.log(`SPAWN: resetting distance for ${this.name} in ${this.operation.name}`);
            this.memory.distanceToSpawn = undefined;
        }
    }

    /**
     * General purpose function for spawning creeps
     * @param roleName - Used to find creeps belonging to this role, examples: miner, energyCart
     * @param getBody - function that returns the body to be used if a new creep needs to be spawned
     * @param max - how many creeps are currently desired, pass 0 to halt spawning
     * @param options - Optional parameters like prespawn interval, whether to disable attack notifications, etc.
     * @returns {Creep[]}
     */
    protected headCount(roleName: string, getBody: () => string[], max: number, options?: HeadCountOptions): Creep[] {
        if (!options) { options = {}; }
        let roleArray = [];
        if (!this.memory.spawn[roleName]) { this.memory.spawn[roleName] = this.findOrphans(roleName); }

        let count = 0;
        for (let i = 0; i < this.memory.spawn[roleName].length; i++ ) {
            let creepName = this.memory.spawn[roleName][i];
            let creep = Game.creeps[creepName];
            if (creep) {

                // newer code to implement waypoints/boosts
                let prepared = this.prepCreep(creep, options);
                if (prepared) {
                    roleArray.push(creep);
                }

                let ticksNeeded = 0;
                if (options.prespawn !== undefined) {
                    ticksNeeded += creep.body.length * 3;
                    ticksNeeded += options.prespawn;
                }
                if (!creep.ticksToLive || creep.ticksToLive > ticksNeeded) { count++; }
            }
            else {
                this.memory.spawn[roleName].splice(i, 1);
                Memory.creeps[creepName] = undefined;
                i--;
            }
        }

        if (count < max && this.allowSpawn && this.spawnGroup.isAvailable && (this.hasVision || options.blindSpawn)) {
            let creepName = this.operation.name + "_" + roleName + "_" + Math.floor(Math.random() * 100);
            let outcome = this.spawnGroup.spawn(getBody(), creepName, options.memory, options.reservation);
            if (_.isString(outcome)) this.memory.spawn[roleName].push(creepName);
        }

        return roleArray;
    }

    protected headCount2(roleName: string, getBody: () => string[], getMax: () => number,
                         options: HeadCountOptions = {}): Agent[] {
        let agentArray = [];
        if (!this.memory.hc[roleName]) this.memory.hc[roleName] = this.findOrphans(roleName);
        let creepNames = this.memory.hc[roleName] as string[];

        let count = 0;
        for (let i = 0; i < creepNames.length; i++) {
            let creepName = creepNames[i];
            let creep = Game.creeps[creepName];
            if (creep) {
                let agent = new Agent(creep, this);
                let prepared = this.prepAgent(agent, options);
                if (prepared) agentArray.push(agent);
                let ticksNeeded = 0;
                if (options.prespawn !== undefined) {
                    ticksNeeded += creep.body.length * 3;
                    ticksNeeded += options.prespawn;
                }
                if (!creep.ticksToLive || creep.ticksToLive > ticksNeeded) { count++; }
            }
            else {
                creepNames.splice(i, 1);
                delete Memory.creeps[creepName];
                i--;
            }
        }

        let allowSpawn = this.spawnGroup.isAvailable && this.allowSpawn && (this.hasVision || options.blindSpawn);
        if (allowSpawn && count < getMax()) {
            let creepName = `${this.operation.name}_${roleName}_${Math.floor(Math.random() * 100)}`;
            let outcome = this.spawnGroup.spawn(getBody(), creepName, options.memory, options.reservation);
            if (_.isString(outcome)) { creepNames.push(creepName); }
        }

        return agentArray;
    }

    protected spawnSharedCreep(roleName: string, getBody: () => string[]) {
        let spawnMemory = this.spawnGroup.spawns[0].memory;
        if (!spawnMemory.communityRoles) spawnMemory.communityRoles = {};

        let employerName = this.operation.name + this.name;
        let creep;
        if (spawnMemory.communityRoles[roleName]) {
            let creepName = spawnMemory.communityRoles[roleName];
            creep = Game.creeps[creepName];
            if (creep && Game.map.getRoomLinearDistance(this.spawnGroup.room.name, creep.room.name) <= 3) {
                if (creep.memory.employer === employerName || (!creep.memory.lastTickEmployed || Game.time - creep.memory.lastTickEmployed > 1)) {
                    creep.memory.employer = employerName;
                    creep.memory.lastTickEmployed = Game.time;
                    return creep;
                }
            }
            else {
                delete Memory.creeps[creepName];
                delete spawnMemory.communityRoles[roleName];
            }
        }

        if (!creep && this.spawnGroup.isAvailable) {
            let creepName = "community_" + roleName;
            while (Game.creeps[creepName]) {
                creepName = "community_" + roleName + "_" + Math.floor(Math.random() * 100);
            }
            let outcome = this.spawnGroup.spawn(getBody(), creepName, undefined, undefined);
            if (_.isString(outcome)) {
                spawnMemory.communityRoles[roleName] = outcome;
            }
            else if (Game.time % 10 !== 0 && outcome !== ERR_NOT_ENOUGH_RESOURCES) {
                console.log(`error spawning community ${roleName} in ${this.operation.name} outcome: ${outcome}`);
            }
        }
    }

    /**
     * Returns creep body array with desired number of parts in this order: WORK → CARRY → MOVE
     * @param workCount
     * @param carryCount
     * @param movecount
     * @returns {string[]}
     */
    protected workerBody(workCount: number, carryCount: number, movecount: number): string[] {
        let body: string [] = [];
        for (let i = 0; i < workCount; i++) {
            body.push(WORK);
        }
        for (let i = 0; i < carryCount; i++) {
            body.push(CARRY);
        }
        for (let i = 0; i < movecount; i++) {
            body.push(MOVE);
        }
        return body;
    }

    protected configBody(config: {[partType: string]: number}): string[] {
        let body: string[] = [];
        for (let partType in config) {
            let amount = config[partType];
            for (let i = 0; i < amount; i++) {
                body.push(partType);
            }
        }
        return body;
    }

    /**
     * Returns creep body array with the desired ratio of parts, governed by how much spawn energy is possible
     * @param workRatio
     * @param carryRatio
     * @param moveRatio
     * @param spawnFraction - proportion of spawn energy to be used up to 50 body parts, .5 would use half, 1 would use all
     * @param limit - set a limit to the number of units (useful if you know the exact limit, like with miners)
     * @returns {string[]}
     */
    protected bodyRatio(workRatio: number, carryRatio: number, moveRatio: number, spawnFraction: number, limit?: number): string[] {
        let sum = workRatio * 100 + carryRatio * 50 + moveRatio * 50;
        let partsPerUnit = workRatio + carryRatio + moveRatio;
        if (!limit) limit = Math.floor(50 / partsPerUnit);
        let maxUnits = Math.min(Math.floor((this.spawnGroup.maxSpawnEnergy * spawnFraction) / sum), limit);
        return this.workerBody(workRatio * maxUnits, carryRatio * maxUnits, moveRatio * maxUnits);
    }

    /**
     * General purpose checking for creep load
     * @param creep
     * @returns {boolean}
     */
    protected hasLoad(creep: Creep): boolean {
        if (creep.memory.hasLoad && _.sum(creep.carry) === 0) {
            creep.memory.hasLoad = false;
        }
        else if (!creep.memory.hasLoad && _.sum(creep.carry) === creep.carryCapacity) {
            creep.memory.hasLoad = true;
        }
        return creep.memory.hasLoad;
    }

    // deprecated
    /**
     * Used to determine cart count/size based on transport distance and the bandwidth needed
     * @param distance - distance (or average distance) from point A to point B
     * @param load - how many resource units need to be transported per tick (example: 10 for an energy source)
     * @returns {{body: string[], cartsNeeded: number}}
     */
    protected cacheTransportAnalysis(distance: number, load: number): TransportAnalysis {
        if (!this.memory.transportAnalysis || load !== this.memory.transportAnalysis.load
            || distance !== this.memory.transportAnalysis.distance) {
            this.memory.transportAnalysis = Mission.analyzeTransport(distance, load, this.spawnGroup.maxSpawnEnergy)
        }
        return this.memory.transportAnalysis;
    }

    // deprecated
    static analyzeTransport(distance: number, load: number, maxSpawnEnergy: number): TransportAnalysis {
        // cargo units are just 2 CARRY, 1 MOVE, which has a capacity of 100 and costs 150
        let maxUnitsPossible = Math.min(Math.floor(maxSpawnEnergy /
            ((BODYPART_COST[CARRY] * 2) + BODYPART_COST[MOVE])), 16);
        let bandwidthNeeded = distance * load * 2.1;
        let cargoUnitsNeeded = Math.ceil(bandwidthNeeded / (CARRY_CAPACITY * 2));
        let cartsNeeded = Math.ceil(cargoUnitsNeeded / maxUnitsPossible);
        let cargoUnitsPerCart = Math.floor(cargoUnitsNeeded / cartsNeeded);
        return {
            load: load,
            distance: distance,
            cartsNeeded: cartsNeeded,
            carryCount: cargoUnitsPerCart * 2,
            moveCount: cargoUnitsPerCart,
        };
    }

    // deprecated
    static loadFromSource(source: Source): number {
        return Math.max(source.energyCapacity, SOURCE_ENERGY_CAPACITY) / ENERGY_REGEN_TIME;
    }

    /**
     * General-purpose energy getting, will look for an energy source in the same missionRoom as the operation flag (not creep)
     * @param creep
     * @param nextDestination
     * @param highPriority - allows you to withdraw energy before a battery reaches an optimal amount of energy, jumping
     * ahead of any other creeps trying to get energy
     * @param getFromSource
     */

    protected procureEnergy(creep: Creep, nextDestination?: RoomObject, highPriority = false, getFromSource = false) {
        let battery = this.getBattery(creep);

        if (battery) {
            if (creep.pos.isNearTo(battery)) {
                let outcome;
                if (highPriority) {
                    if (battery.store.energy >= 50) {
                        outcome = creep.withdraw(battery, RESOURCE_ENERGY);
                    }
                }
                else {
                    outcome = creep.withdrawIfFull(battery, RESOURCE_ENERGY);
                }
                if (outcome === OK) {
                    creep.memory.batteryId = undefined;
                    if (nextDestination) {
                        creep.blindMoveTo(nextDestination, {maxRooms: 1});
                    }
                }
            }
            else {
                creep.blindMoveTo(battery, {maxRooms: 1});
            }
        }
        else {
            if (getFromSource) {
                let closest = creep.pos.findClosestByRange<Source>(this.sources);
                if (closest) {
                    if (creep.pos.isNearTo(closest)) {
                        creep.harvest(closest);
                    }
                    else {
                        creep.blindMoveTo(closest);
                    }
                }
                else if (!creep.pos.isNearTo(this.flag)) {
                    creep.blindMoveTo(this.flag);
                }
            }
            else {
                if (creep.memory._move) {
                    let moveData = creep.memory._move.dest;
                    let dest = new RoomPosition(moveData.x, moveData.y, moveData.room);
                    creep.idleOffRoad({pos: dest}, true);
                }
                else {
                    creep.idleOffRoad(this.flag, true);
                }
            }
        }
    }

    /**
     * Will return storage if it is available, otherwise will look for an alternative battery and cache it
     * @param creep - return a battery relative to the missionRoom that the creep is currently in
     * @returns {any}
     */

    protected getBattery(creep: Creep): Creep | StructureContainer | StructureTerminal | StructureStorage {
        let minEnergy = creep.carryCapacity - creep.carry.energy;
        if (creep.room.storage && creep.room.storage.store.energy > minEnergy) {
            return creep.room.storage;
        }

        return creep.rememberBattery();
    }

    protected getFlagSet(identifier: string, max = 10): Flag[] {

        let flags = [];
        for (let i = 0; i < max; i++) {
            let flag = Game.flags[this.operation.name + identifier + i];
            if (flag) {
                flags.push(flag);
            }
        }
        return flags;
    }

    protected flagLook(lookConstant: string, identifier: string, max = 10) {

        let objects = [];

        let flags = this.getFlagSet(identifier, max);
        for (let flag of flags) {
            if (flag.room) {
                let object = _.head(flag.pos.lookFor(lookConstant));
                if (object) {
                    objects.push(object);
                }
                else {
                    flag.remove();
                }
            }
        }

        return objects;
    }

    // deprecated, use similar function on TransportGuru
    getStorage(pos: RoomPosition): StructureStorage {
        if (this.memory.tempStorageId) {
            let storage = Game.getObjectById<StructureStorage>(this.memory.tempStorageId);
            if (storage) {
                return storage;
            }
            else {
                console.log("ATTN: Clearing temporary storage id due to not finding object in", this.operation.name);
                this.memory.tempStorageId = undefined;
            }
        }

        if (this.memory.storageId) {
            let storage = Game.getObjectById<StructureStorage>(this.memory.storageId);
            if (storage && storage.room.controller.level >= 4) {
                return storage;
            }
            else {
                console.log("ATTN: attempting to find better storage for", this.name, "in", this.operation.name);
                this.memory.storageId = undefined;
                return this.getStorage(pos);
            }
        }
        else {
            let storages = _.filter(this.empire.storages, (s: Structure) => s.room.controller.level >= 4);
            let storage = pos.findClosestByLongPath(storages) as Storage;
            if (!storage) {
                storage = pos.findClosestByRoomRange(storages) as Storage;
                console.log("couldn't find storage via path, fell back to find closest by missionRoom range for", this.operation.name);
            }
            if (storage) {
                console.log("ATTN: attempting to find better storage for", this.name, "in", this.operation.name);
                this.memory.storageId = storage.id;
                return storage;
            }
        }
    }

    idleNear(creep: Creep, place: {pos: RoomPosition}, desiredRange = 3) {
        let range = creep.pos.getRangeTo(place);

        if (range < desiredRange) {
            creep.idleOffRoad(place);
        }
        else if (range === desiredRange) {
            creep.idleOffRoad(place, true);
        }
        else {
            creep.blindMoveTo(place);
        }
    }

    private findOrphans(roleName: string) {
        let creepNames = [];
        for (let creepName in Game.creeps) {
            if (creepName.indexOf(this.operation.name + "_" + roleName + "_") > -1) {
                creepNames.push(creepName);
            }
        }
        return creepNames;
    }

    protected recycleCreep(creep: Creep) {
        let spawn = this.spawnGroup.spawns[0];
        if (creep.pos.isNearTo(spawn)) {
            spawn.recycleCreep(creep);
        }
        else {
            creep.blindMoveTo(spawn);
        }
    }

    private prepCreep(creep: Creep, options: HeadCountOptions) {
        if (!creep.memory.prep) {
            if (options.disableNotify) {
                this.disableNotify(creep);
            }
            let boosted = creep.seekBoost(creep.memory.boosts, creep.memory.allowUnboosted);
            if (!boosted) return false;
            if (creep.spawning) return false;
            let outcome = creep.travelByWaypoint(this.waypoints);
            if (outcome !== DESTINATION_REACHED) return false;
            if (!options.skipMoveToRoom && (creep.room.name !== this.flag.pos.roomName || creep.isNearExit(1))) {
                if (creep.room.roomType === ROOMTYPE_SOURCEKEEPER) {
                    creep.avoidSK(this.flag);
                }
                else {
                    empire.traveler.travelTo(creep, this.flag);
                }
                return false;
            }
            delete creep.memory._travel;
            creep.memory.prep = true;
        }
        return true;
    }

    private prepAgent(agent: Agent, options: HeadCountOptions) {
        if (!agent.memory.prep) {
            if (agent.creep.spawning) return false;
            if (options.disableNotify) {
                this.disableNotify(agent)
            }
            let boosted = agent.seekBoost(options.boosts, options.allowUnboosted);
            if (!boosted) return false;
            if (!options.skipMoveToRoom && (agent.pos.roomName !== this.flag.pos.roomName || agent.pos.isNearExit(1))) {
                agent.avoidSK(this.flag);
                return;
            }
            agent.memory.prep = true;
        }
        return true;
    }

    findPartnerships(creeps: Creep[], role: string) {
        for (let creep of creeps) {
            if (!creep.memory.partner) {
                if (!this.partnerPairing[role]) this.partnerPairing[role] = [];
                this.partnerPairing[role].push(creep);
                for (let otherRole in this.partnerPairing) {
                    if (role === otherRole) continue;
                    let otherCreeps = this.partnerPairing[otherRole];
                    let closestCreep;
                    let smallestAgeDifference = Number.MAX_VALUE;
                    for (let otherCreep of otherCreeps) {
                        let ageDifference = Math.abs(creep.ticksToLive - otherCreep.ticksToLive);
                        if (ageDifference < smallestAgeDifference) {
                            smallestAgeDifference = ageDifference;
                            closestCreep = otherCreep;
                        }
                    }

                    if (closestCreep) {
                        closestCreep.memory.partner = creep.name;
                        creep.memory.partner = closestCreep.name;
                    }
                }
            }
        }
    }

    protected findDistanceToSpawn(destination: RoomPosition): number {
        if (!this.memory.distanceToSpawn) {
            let roomLinearDistance = Game.map.getRoomLinearDistance(this.spawnGroup.pos.roomName, destination.roomName);
            if (roomLinearDistance === 0) {
                let distance = this.spawnGroup.pos.getPathDistanceTo(destination);
                if (!distance) {
                    console.log(`SPAWN: error finding distance in ${this.operation.name} for object at ${destination}`);
                    return;
                }
                this.memory.distanceToSpawn = distance;
            }
            else if (roomLinearDistance <= OBSERVER_RANGE) {
                this.memory.distanceToSpawn = (roomLinearDistance + 1) * 50;
            }
            else {
                console.log(`SPAWN: likely portal travel detected in ${this.operation.name}, setting distance to 200`);
                this.memory.distanceToSpawn = 200;
            }
        }

        return this.memory.distanceToSpawn;
    }

    protected disableNotify(creep: Creep | Agent) {
        if (creep instanceof Agent) {
            creep = creep.creep;
        }

        if (!creep.memory.notifyDisabled) {
            creep.notifyWhenAttacked(false);
            creep.memory.notifyDisabled = true;
        }
    }

    protected pavePath(start: {pos: RoomPosition}, finish: {pos: RoomPosition}, rangeAllowance: number, ignoreLimit = false): number {
        if (Game.time - this.memory.paveTick < 1000) return;

        let path = this.findPavedPath(start.pos, finish.pos, rangeAllowance);

        if (!path) {
            console.log(`incomplete pavePath, please investigate (${this.operation.name}), start: ${start.pos}, finish: ${finish.pos}, mission: ${this.name}`);
            return;
        }

        let newConstructionPos = this.examinePavedPath(path);

        if (newConstructionPos && (ignoreLimit || Object.keys(Game.constructionSites).length < 60)) {
            if (!Game.cache.placedRoad) {
                Game.cache.placedRoad = true;
                console.log(`PAVER: placed road ${newConstructionPos} in ${this.operation.name}`);
                newConstructionPos.createConstructionSite(STRUCTURE_ROAD);
            }
        }
        else {
            this.memory.paveTick = Game.time;
            if (_.last(path).inRangeTo(finish.pos, rangeAllowance)) {
                return path.length;
            }
        }
    }

    protected findPavedPath(start: RoomPosition, finish: RoomPosition, rangeAllowance: number): RoomPosition[] {
        const ROAD_COST = 3;
        const PLAIN_COST = 4;
        const SWAMP_COST = 5;
        const AVOID_COST = 7;

        let maxDistance = Game.map.getRoomLinearDistance(start.roomName, finish.roomName);
        let ret = PathFinder.search(start, [{pos: finish, range: rangeAllowance}], {
            plainCost: PLAIN_COST,
            swampCost: SWAMP_COST,
            maxOps: 12000,
            roomCallback: (roomName: string): CostMatrix | boolean => {

                // disqualify rooms that involve a circuitous path
                if (Game.map.getRoomLinearDistance(start.roomName, roomName) > maxDistance) {
                    return false;
                }

                // disqualify enemy rooms
                if (this.empire.memory.hostileRooms[roomName]) {
                    return false;
                }

                let room = Game.rooms[roomName];
                if (!room) {
                    let roomType = helper.roomTypeFromName(roomName);
                    if (roomType === ROOMTYPE_ALLEY) {
                        let matrix = new PathFinder.CostMatrix();
                        return helper.blockOffExits(matrix, AVOID_COST, roomName);
                    }
                    return;
                }

                let matrix = new PathFinder.CostMatrix();
                helper.addStructuresToMatrix(matrix, room, ROAD_COST);

                // avoid controller
                if (room.controller) {
                    helper.blockOffPosition(matrix, room.controller, 3, AVOID_COST);
                }

                // avoid container adjacency
                let sources = room.find<Source>(FIND_SOURCES);
                for (let source of sources) {
                    let container = source.findMemoStructure<StructureContainer>(STRUCTURE_CONTAINER, 1);
                    if (container) {
                        helper.blockOffPosition(matrix, container, 1, AVOID_COST);
                    }
                }

                // add construction sites too
                let constructionSites = room.find<ConstructionSite>(FIND_MY_CONSTRUCTION_SITES);
                for (let site of constructionSites) {
                    if (site.structureType === STRUCTURE_ROAD) {
                        matrix.set(site.pos.x, site.pos.y, ROAD_COST);
                    }
                    else {
                        matrix.set(site.pos.x, site.pos.y, 0xff);
                    }
                }

                return matrix;
            },
        });

        if (!ret.incomplete) {
            return ret.path;
        }
        else {
            console.log(ret.ops)
        }
    }

    private examinePavedPath(path: RoomPosition[]) {

        let repairIds = [];
        let hitsToRepair = 0;

        for (let i = 0; i < path.length; i++) {
            let position = path[i];
            if (!Game.rooms[position.roomName]) return;
            if (position.isNearExit(0)) continue;
            let road = position.lookForStructure(STRUCTURE_ROAD);
            if (road) {
                repairIds.push(road.id);
                hitsToRepair += road.hitsMax - road.hits;
                // TODO: calculate how much "a whole lot" should be based on paver repair rate
                const A_WHOLE_LOT = 1000000;
                if (!this.memory.roadRepairIds && (hitsToRepair > A_WHOLE_LOT || road.hits < road.hitsMax * .20)) {
                    console.log(`PAVER: I'm being summoned in ${this.operation.name}`);
                    this.memory.roadRepairIds = repairIds;
                }
                continue;
            }
            let construction = position.lookFor<ConstructionSite>(LOOK_CONSTRUCTION_SITES)[0];
            if (construction) continue;
            return position;
        }
    }

    protected paverActions(paver: Creep) {

        let hasLoad = this.hasLoad(paver);
        if (!hasLoad) {
            this.procureEnergy(paver, this.findRoadToRepair());
            return;
        }

        let road = this.findRoadToRepair();

        if (!road) {
            console.log(`this is ${this.operation.name} paver, checking out with ${paver.ticksToLive} ticks to live`);
            delete Memory.creeps[paver.name];
            paver.idleOffRoad(this.room.controller);
            return;
        }

        let paving = false;
        if (paver.pos.inRangeTo(road, 3) && !paver.pos.isNearExit(0)) {
            paving = paver.repair(road) === OK;
            let hitsLeftToRepair = road.hitsMax - road.hits;
            if (hitsLeftToRepair > 10000) {
                paver.yieldRoad(road, true);
            }
            else if (hitsLeftToRepair > 1500) {
                paver.yieldRoad(road, false)
            }
        }
        else {
            paver.blindMoveTo(road);
        }

        if (!paving) {
            road = paver.pos.lookForStructure(STRUCTURE_ROAD) as StructureRoad;
            if (road && road.hits < road.hitsMax) paver.repair(road);
        }

        let creepsInRange = _.filter(paver.pos.findInRange(FIND_MY_CREEPS, 1), (c: Creep) => {
            return c.carry.energy > 0 && c.partCount(WORK) === 0;
        }) as Creep[];

        if (creepsInRange.length > 0) {
            creepsInRange[0].transfer(paver, RESOURCE_ENERGY);
        }
    }

    private findRoadToRepair(): StructureRoad {
        if (!this.memory.roadRepairIds) return;

        let road = Game.getObjectById<StructureRoad>(this.memory.roadRepairIds[0]);
        if (road && road.hits < road.hitsMax) {
            return road;
        }
        else {
            this.memory.roadRepairIds.shift();
            if (this.memory.roadRepairIds.length > 0) {
                return this.findRoadToRepair();
            }
            else {
                this.memory.roadRepairIds = undefined;
            }
        }
    }

    protected spawnPaver(): Creep {
        if (this.room.controller && this.room.controller.level === 1) return;
        let paverBody = () => { return this.bodyRatio(1, 3, 2, 1, 5); };
        return this.spawnSharedCreep("paver", paverBody);
    }

    protected setPrespawn(creep: Creep) {
        this.memory.prespawn = 1500 - creep.ticksToLive;
    }

    protected registerPrespawn(agent: Agent) {
        if (!agent.memory.registered) {
            agent.memory.registered = true;
            this.memory.prespawn = CREEP_LIFE_TIME - agent.creep.ticksToLive;
        }
    }
}