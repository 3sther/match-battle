// Общие типы игрового ядра. Без Phaser/DOM - см. src/core/README.md.

/** Три боевых типа фишек + особый ability-тайл (wildcard, см. board.ts). */
export type TileType = 'sword' | 'heart' | 'shield' | 'ability';

/** Боевые типы фишек без ability - именно они определяют эффект цепочки. */
export type CombatTileType = 'sword' | 'heart' | 'shield';

export type Faction = 'fire' | 'wood' | 'water' | 'yin' | 'yang';

/** Роль героя в ростере (влияет на статы и композицию состава). */
export type Role = 'tank' | 'dd' | 'support' | 'hybrid';

/** Архетип ульты - определяет её эффект и какая цепочка заряжает её на 100%. */
export type UltimateType = 'dd' | 'support' | 'tank';

export interface UltimateSpec {
  type: UltimateType;
  /** Индивидуальный множитель силы поверх базовой силы архетипа (config.ULTIMATE_POWER). */
  power: number;
}

/** Статичное описание героя (не меняется в течение боя). */
export interface Hero {
  id: string;
  name: string;
  role: Role;
  faction: Faction;
  maxHp: number;
  atk: number;
  def: number;
  ultimate: UltimateSpec;
}

/** Живое состояние героя в бою - мутируется по ходу симуляции. */
export interface HeroState {
  hero: Hero;
  hp: number;
  /** Заряд ульты: 0..N, 1.0 = готова к касту, >1.0 = overcharge. */
  charge: number;
  /** Сколько входящих меч-цепочек ещё вынуждены бить по этому герою (провокация танка). */
  tauntTurns: number;
}

export interface TeamState {
  heroes: HeroState[]; // длина 3
  /** Общий командный щит - флэт-пул, поглощает урон до HP. */
  shield: number;
}

export type Position = { row: number; col: number };

export interface Cell {
  type: TileType;
}

export interface Board {
  size: number;
  grid: Cell[][]; // grid[row][col], row 0 = верх доски
}

/** Один матчнутый (или потенциально матчнутый - для AI) набор клеток. */
export interface Chain {
  cells: Position[];
  /** Базовый тип цепочки - всегда определён, т.к. компонент стартует от базовой (не ability) клетки. */
  effectiveType: CombatTileType;
  /** Входил ли в цепочку хотя бы один ability-тайл (даёт мгновенный заряд ульт всем, см. combat.ts). */
  includesAbilityTile: boolean;
}

export interface ChainResolveResult {
  chain: Chain;
  length: number;
  /** Заспавнился ли новый ability-тайл (цепочка была длиннее ABILITY_TILE_CHAIN_LENGTH). */
  spawnedAbilityTile: boolean;
}
