import {Operation} from "./Operation";
import {EmergencyMinerMission} from "./EmergencyMission";
import {RefillMission} from "./RefillMission";
import {PowerMission} from "./PowerMission";
import {TerminalNetworkMission} from "./TerminalNetworkMission";
import {IgorMission} from "./IgorMission";
import {LinkMiningMission} from "./LinkMiningMission";
import {MiningMission} from "./MiningMission";
import {BuildMission} from "./BuildMission";
import {LinkNetworkMission} from "./LinkNetworkMission";
import {GeologyMission} from "./GeologyMission";
import {UpgradeMission} from "./UpgradeMission";
import {PaverMission} from "./PaverMission";
import {Coord, SeedData} from "./interfaces";
import {NEED_ENERGY_THRESHOLD, ENERGYSINK_THRESHOLD} from "./constants";
import {helper} from "./helper";
import {SeedAnalysis} from "./SeedAnalysis";

const SPAWNCART_BODYUNIT_LIMIT = 10;
const GEO_SPAWN_COST = 5000;

export abstract class ControllerOperation extends Operation {

    memory: {
        powerMining: boolean
        noMason: boolean
        masonPotency: number
        builderPotency: number
        wallBoost: boolean
        mason: { activateBoost: boolean }
        network: { scanData: { roomNames: string[]} }
        centerPosition: RoomPosition;
        centerPoint: Coord;
        rotation: number
        repairIndex: number
        temporaryPlacement: {[level: number]: boolean}
        checkLayoutIndex: number
        flexLayoutMap: {[structureType: string]: Coord[]}
        flexRadius: number;
        seedData: SeedData;
    };

    protected abstract addDefense();
    protected abstract repairWalls();
    protected abstract findStructureCount(structureType: string): number;
    protected abstract allowedCount(structureType: string, level: number): number;
    protected abstract layoutCoords(structureType: string): Coord[];
    protected abstract temporaryPlacement(controllerLevel: number);

    initOperation() {

        if (!this.flag.room) return; // TODO: remote revival

        // initOperation FortOperation variables
        this.spawnGroup = this.empire.getSpawnGroup(this.flag.room.name);
        this.empire.register(this.flag.room);

        // spawn emergency miner if needed
        this.addMission(new EmergencyMinerMission(this));

        // refill spawning energy - will spawn small spawnCart if needed
        let structures = this.flag.room.findStructures(STRUCTURE_EXTENSION)
            .concat(this.flag.room.find(FIND_MY_SPAWNS)) as Structure[];
        let maxCarts = this.flag.room.storage ? 1 : 2;
        this.addMission(new RefillMission(this, "spawnCart", maxCarts, structures, SPAWNCART_BODYUNIT_LIMIT, true));

        this.addDefense();

        if (this.memory.powerMining) {
            this.addMission(new PowerMission(this));
        }

        // energy network
        if (this.flag.room.terminal && this.flag.room.storage) {
            this.addMission(new TerminalNetworkMission(this));
            this.addMission(new IgorMission(this));
        }

        // harvest energy
        for (let i = 0; i < this.sources.length; i++) {
            if (this.sources[i].pos.lookFor(LOOK_FLAGS).length > 0) continue;
            let source = this.sources[i];
            if (this.flag.room.controller.level === 8 && this.flag.room.storage) {
                let link = source.findMemoStructure(STRUCTURE_LINK, 2) as StructureLink;
                if (link) {
                    this.addMission(new LinkMiningMission(this, "miner" + i, source, link));
                    continue;
                }
            }
            this.addMission(new MiningMission(this, "miner" + i, source));
        }

        // build construction
        let allowBuilderSpawn = this.flag.room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;
        this.addMission(new BuildMission(this, "builder", this.calcBuilderPotency(), allowBuilderSpawn));

        // use link array near storage to fire energy at controller link (pre-rcl8)
        if (this.flag.room.storage) {
            this.addMission(new LinkNetworkMission(this));

            let extractor = this.mineral.pos.lookFor<StructureExtractor>(LOOK_STRUCTURES)[0];
            if (this.flag.room.energyCapacityAvailable > GEO_SPAWN_COST && extractor && extractor.my) {
                this.addMission(new GeologyMission(this));
            }
        }

        // upgrader controller
        let boostUpgraders = this.flag.room.controller.level < 8;
        this.addMission(new UpgradeMission(this, boostUpgraders));

        // repair roads
        this.addMission(new PaverMission(this));

        this.autoLayout();
        this.repairWalls();
    }

    finalizeOperation() {
    }

    invalidateOperationCache() {
        this.memory.masonPotency = undefined;
        this.memory.builderPotency = undefined;
    }

    calcMasonPotency(): number {
        if (!this.memory.masonPotency) {
            let surplusMode = this.flag.room.storage && this.flag.room.storage.store.energy > NEED_ENERGY_THRESHOLD;
            let megaSurplusMode = this.flag.room.storage && this.flag.room.storage.store.energy > ENERGYSINK_THRESHOLD;
            let potencyBasedOnStorage = megaSurplusMode ? 10 : surplusMode ? 5 : 1;

            if (this.memory.wallBoost) {
                potencyBasedOnStorage = 20;
            }

            // would happen to be the same as the potency used for builders
            let potencyBasedOnSpawn = this.calcBuilderPotency();

            if (this.memory.wallBoost) {
                this.memory.mason.activateBoost = true;
            }

            this.memory.masonPotency = Math.min(potencyBasedOnSpawn, potencyBasedOnStorage);
        }
        return this.memory.masonPotency;
    }

    calcBuilderPotency(): number {
        if (!this.memory.builderPotency) {
            this.memory.builderPotency = Math.min(Math.floor(this.spawnGroup.maxSpawnEnergy / 175), 20);
        }
        return this.memory.builderPotency;
    }

    public nuke(x: number, y: number, roomName: string): string {
        let nuker = _.head(this.flag.room.find(FIND_MY_STRUCTURES, {filter: {structureType: STRUCTURE_NUKER}})) as StructureNuker;
        let outcome = nuker.launchNuke(new RoomPosition(x, y, roomName));
        if (outcome === OK) {
            this.empire.addNuke({tick: Game.time, roomName: roomName});
            return "NUKER: Bombs away! \\o/";
        }
        else {
            return `NUKER: error: ${outcome}`;
        }
    }

    addAllyRoom(roomName: string) {
        if (_.includes(this.memory.network.scanData.roomNames, roomName)) {
            return "NETWORK: " + roomName + " is already being scanned by " + this.name;
        }

        this.memory.network.scanData.roomNames.push(roomName);
        this.empire.addAllyForts([roomName]);
        return "NETWORK: added " + roomName + " to rooms scanned by " + this.name;
    }

    private autoLayout() {

        if (!this.memory.centerPosition || this.memory.rotation === undefined) {
            let spawns = this.flag.room.find<StructureSpawn>(FIND_MY_SPAWNS);
            if (spawns.length === 1) {
                this.findCenterPositionFromSpawn(spawns[0]);
            }
            return;
        }

        let structureTypes = Object.keys(CONSTRUCTION_COST);

        if (this.memory.checkLayoutIndex === undefined || this.memory.checkLayoutIndex >= structureTypes.length) {
            this.memory.checkLayoutIndex = 0;
        }
        let structureType = structureTypes[this.memory.checkLayoutIndex++];

        let allowedCount = this.allowedCount(structureType, this.flag.room.controller.level);
        let count = this.findStructureCount(structureType);

        if (count < allowedCount) {
            console.log(structureType, allowedCount, count);
            this.findNextConstruction(structureType, allowedCount - count)
        }

        this.temporaryPlacement(this.flag.room.controller.level);
    }

    private findNextConstruction(structureType: string, amountNeeded: number) {
        let amountOrdered = 0;

        let coords = this.layoutCoords(structureType);

        for (let coord of coords) {
            let position = helper.coordToPosition(coord, this.memory.centerPosition, this.memory.rotation);
            if (!position) {
                console.log(`LAYOUT: bad position, is centerPoint misplaced? (${this.name})`);
                return;
            }
            let hasStructure = position.lookForStructure(structureType);
            if (hasStructure) continue;
            let hasConstruction = position.lookFor(LOOK_CONSTRUCTION_SITES)[0];
            if (hasConstruction) continue;

            let outcome = position.createConstructionSite(structureType);
            if (outcome === OK) {
                console.log(`LAYOUT: placing ${structureType} at ${position} (${this.name})`);
                amountOrdered++;
            }
            else {
                console.log(`LAYOUT: bad construction placement: ${outcome}, ${structureType}, ${position} (${this.name})`);
            }

            if (amountOrdered === amountNeeded) {
                console.log(`LAYOUT: finished placing construction for: ${structureType} (${this.name})`);
                break;
            }
        }
    }

    private findCenterPositionFromSpawn(spawn: StructureSpawn) {

        if (!this.memory.seedData) {
            let sourceData = [];
            for (let source of this.flag.room.find<Source>(FIND_SOURCES)) {
                sourceData.push({pos: source.pos, amount: 3000 })
            }
            this.memory.seedData = {
                sourceData: sourceData,
                seedScan: {},
                seedSelectData: undefined
            }
        }

        let analysis = new SeedAnalysis(this.flag.room, this.memory.seedData);
        let results = analysis.run(spawn);
        if (results) {
            let centerPosition = new RoomPosition(results.origin.x, results.origin.y, this.flag.room.name);
            if (results.seedType === this.type) {
                console.log(`${this.name} found best seed of type ${results.seedType}, initiating auto-layout`);
                this.memory.centerPosition = centerPosition;
                this.memory.rotation = results.rotation;
            }
            else {
                console.log(`${this.name} found best seed of another type, replacing operation`);
                let flagName = `${results.seedType}_${this.name}`;
                Memory.flags[flagName] = { centerPosition: centerPosition, rotation: results.rotation };
                this.flag.pos.createFlag(flagName, COLOR_GREY);
                this.flag.remove();
            }
            this.memory.seedData = undefined; // clean-up memory
        }
        else {
            console.log(`${this.name} could not find a suitable auto-layout, consider using another spawn location or room`);
        }
    }
}