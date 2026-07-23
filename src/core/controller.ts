// Пошаговый BattleController поверх примитивов ядра - без Phaser (используется BattleScene
// и тестами). Правила хода (монетка/разогрев/распад щита/порядок ульта-затем-цепочка) общие
// с headless-симулятором (simulateBattle в index.ts) - см. turn.ts, единая точка правды.

import { createBoard } from './board';
import { castUltimate, createTeamState } from './combat';
import { createRng, type Rng } from './rng';
import { decideTurn, type AiLevel } from './ai';
import { applyTurnDecision, computeDamageMult, decayShield, type TurnDecision } from './turn';
import {
  FIRST_ACTION_DAMAGE_MULT,
  MAX_BATTLE_TURNS,
  MAX_CHAIN_LENGTH,
  SECOND_PLAYER_START_CHARGE,
  SHIELD_RETENTION_PER_TURN,
} from './config';
import type { Board, Chain, CombatTileType, Hero, Position, TeamState, TileType } from './types';

export type Side = 'A' | 'B';
/** Статус боя: идёт, или чья-то победа, или ничья (только по истечении MAX_BATTLE_TURNS). */
export type BattleStatus = 'ongoing' | 'A' | 'B' | 'draw';

export interface BattleState {
  board: Board;
  teamA: TeamState;
  teamB: TeamState;
  rng: Rng;
  /** Чья сторона ходит следующей. */
  acting: Side;
  /** Число уже совершённых действий (суммарно за обе стороны) - для монетки/разогрева. */
  turns: number;
  firstActionDamageMult: number;
  status: BattleStatus;
  /** Человекочитаемый лог боя - для дебага и верификации баланса цифрами (кнопка ЛОГ в сцене). */
  log: string[];
}

export interface CreateBattleOptions {
  secondPlayerStartCharge?: number;
  firstActionDamageMult?: number;
  /** Кто ходит первым (по умолчанию A). В соло-режиме первым ходит AI - монетка ложится на него. */
  firstActing?: Side;
}

/** Создаёт новый бой 3v3: доску, команды, стартовый заряд второй команды (компенсация хода). */
export function createBattle(
  heroesA: Hero[],
  heroesB: Hero[],
  seed: number,
  opts: CreateBattleOptions = {}
): BattleState {
  const {
    secondPlayerStartCharge = SECOND_PLAYER_START_CHARGE,
    firstActionDamageMult = FIRST_ACTION_DAMAGE_MULT,
    firstActing = 'A',
  } = opts;
  const rng = createRng(seed);
  const board = createBoard(rng);
  const teamA = createTeamState(heroesA);
  const teamB = createTeamState(heroesB);
  // Компенсация достаётся стороне, ходящей ВТОРОЙ.
  const secondTeam = firstActing === 'A' ? teamB : teamA;
  for (const hs of secondTeam.heroes) hs.charge = secondPlayerStartCharge;

  const fmtHero = (h: Hero) =>
    `${h.id} [${h.faction}/${h.role}] hp${h.maxHp} atk${h.atk} def${h.def} ульта:${h.ultimate.type}x${h.ultimate.power}`;
  const log = [
    `=== БОЙ: сид ${seed}, монетка ${firstActionDamageMult} (на первый ход ${firstActing}), стартовый заряд второго ${secondPlayerStartCharge}`,
    `A (игрок): ${heroesA.map(fmtHero).join(' | ')}`,
    `B (AI):    ${heroesB.map(fmtHero).join(' | ')}`,
  ];

  return { board, teamA, teamB, rng, acting: firstActing, turns: 0, firstActionDamageMult, status: 'ongoing', log };
}

function isAdjacent(a: Position, b: Position): boolean {
  return Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1 && !(a.row === b.row && a.col === b.col);
}

function inBounds(board: Board, pos: Position): boolean {
  return pos.row >= 0 && pos.row < board.size && pos.col >= 0 && pos.col < board.size;
}

function typeAt(board: Board, pos: Position): TileType {
  return board.grid[pos.row][pos.col].type;
}

/**
 * Можно ли добавить `next` как следующую клетку к уже начатому пути `path` (path может быть
 * короче 3 - используется во время протяжки пальцем, до финальной проверки длины).
 */
export function canExtendChain(board: Board, path: Position[], next: Position): boolean {
  if (!inBounds(board, next)) return false;
  if (path.some((p) => p.row === next.row && p.col === next.col)) return false; // клетка уже в пути

  const last = path[path.length - 1];
  if (last && !isAdjacent(last, next)) return false; // разрыв - клетки не соседние

  const nextType = typeAt(board, next);
  if (nextType === 'ability') return true; // ability-тайл - wildcard, подходит любой цепочке
  const baseType = path.map((p) => typeAt(board, p)).find((t) => t !== 'ability');
  return baseType === undefined || baseType === nextType;
}

/**
 * Валидирует путь, нарисованный игроком, и превращает его в Chain: клетки в границах доски
 * и без повторов, каждая соседствует (8 направлений) с предыдущей, один боевой тип
 * (ability-тайл - wildcard), длина 3..MAX_CHAIN_LENGTH. Возвращает null, если путь невалиден.
 */
export function getValidChainFromPath(board: Board, path: Position[]): Chain | null {
  if (path.length < 3 || path.length > MAX_CHAIN_LENGTH) return null;
  if (!inBounds(board, path[0])) return null;
  for (let i = 1; i < path.length; i++) {
    if (!canExtendChain(board, path.slice(0, i), path[i])) return null;
  }

  const baseType = path.map((p) => typeAt(board, p)).find((t) => t !== 'ability');
  if (baseType === undefined) return null; // путь из одних ability-тайлов - нет базового типа
  const includesAbilityTile = path.some((p) => typeAt(board, p) === 'ability');
  return { cells: path, effectiveType: baseType as CombatTileType, includesAbilityTile };
}

/** Дефолтная фокус-цель под удар/dd-ульту - враг с наименьшим текущим HP (см. ai.ts pickFocusTarget). */
export function defaultFocusTarget(team: TeamState): string | undefined {
  const alive = team.heroes.filter((h) => h.hp > 0);
  if (alive.length === 0) return undefined;
  return alive.reduce((lowest, h) => (h.hp < lowest.hp ? h : lowest)).hero.id;
}

/** Событие для анимации в сцене - playAction/playAiAction возвращают их списком за один ход. */
export type BattleEvent =
  | { type: 'ultimateCast'; side: Side; heroId: string }
  | { type: 'chainResolved'; side: Side; chain: Chain }
  | { type: 'damage'; side: Side; heroId: string; amount: number }
  | { type: 'heal'; side: Side; heroId: string; amount: number }
  | { type: 'shield'; side: Side; amount: number }
  | { type: 'charge'; side: Side; heroId: string; amount: number }
  | { type: 'death'; side: Side; heroId: string };

export interface ActionResult {
  events: BattleEvent[];
  status: BattleStatus;
}

interface TeamSnapshot {
  hp: Map<string, number>;
  charge: Map<string, number>;
  shield: number;
}

function snapshotTeam(team: TeamState): TeamSnapshot {
  return {
    hp: new Map(team.heroes.map((h) => [h.hero.id, h.hp])),
    charge: new Map(team.heroes.map((h) => [h.hero.id, h.charge])),
    shield: team.shield,
  };
}

/** Сравнивает состояние команды до/после хода и превращает разницу в события для UI. */
function diffTeamEvents(side: Side, before: TeamSnapshot, team: TeamState, ultimateCasterId?: string): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (const hs of team.heroes) {
    const prevHp = before.hp.get(hs.hero.id)!;
    const hpDelta = hs.hp - prevHp;
    if (hpDelta < 0) events.push({ type: 'damage', side, heroId: hs.hero.id, amount: -hpDelta });
    else if (hpDelta > 0) events.push({ type: 'heal', side, heroId: hs.hero.id, amount: hpDelta });
    if (prevHp > 0 && hs.hp === 0) events.push({ type: 'death', side, heroId: hs.hero.id });

    // Заряд кастера обнуляется castUltimate - это уже отражено событием ultimateCast, не дублируем.
    if (hs.hero.id === ultimateCasterId) continue;
    const chargeDelta = hs.charge - before.charge.get(hs.hero.id)!;
    if (Math.abs(chargeDelta) > 1e-4) events.push({ type: 'charge', side, heroId: hs.hero.id, amount: chargeDelta });
  }
  const shieldDelta = team.shield - before.shield;
  if (Math.abs(shieldDelta) > 1e-4) events.push({ type: 'shield', side, amount: shieldDelta });
  return events;
}

function isAlive(team: TeamState): boolean {
  return team.heroes.some((h) => h.hp > 0);
}

/** Переводит события хода в строки лога (округлённые числа, компактно). */
function fmtEvents(events: BattleEvent[]): string[] {
  const lines: string[] = [];
  const charges: string[] = [];
  for (const ev of events) {
    switch (ev.type) {
      case 'ultimateCast':
        lines.push(`  УЛЬТА ${ev.side}:${ev.heroId}`);
        break;
      case 'chainResolved':
        break; // цепочка логируется отдельной строкой с контекстом
      case 'damage':
        lines.push(`  урон ${Math.round(ev.amount)} → ${ev.side}:${ev.heroId}`);
        break;
      case 'heal':
        lines.push(`  хил +${Math.round(ev.amount)} → ${ev.side}:${ev.heroId}`);
        break;
      case 'shield':
        lines.push(
          ev.amount > 0
            ? `  щит ${ev.side} +${Math.round(ev.amount)}`
            : `  щит ${ev.side} ${Math.round(ev.amount)} (поглотил урон/распался)`
        );
        break;
      case 'charge':
        charges.push(`${ev.side}:${ev.heroId}${ev.amount > 0 ? '+' : ''}${ev.amount.toFixed(1)}`);
        break;
      case 'death':
        lines.push(`  ** СМЕРТЬ ${ev.side}:${ev.heroId} **`);
        break;
    }
  }
  if (charges.length > 0) lines.push(`  заряды: ${charges.join(' ')}`);
  return lines;
}

function computeStatus(state: BattleState): BattleStatus {
  const aliveA = isAlive(state.teamA);
  const aliveB = isAlive(state.teamB);
  if (aliveA && aliveB) {
    if (state.turns < MAX_BATTLE_TURNS) return 'ongoing';
    const hpA = state.teamA.heroes.reduce((sum, h) => sum + h.hp, 0);
    const hpB = state.teamB.heroes.reduce((sum, h) => sum + h.hp, 0);
    return hpA === hpB ? 'draw' : hpA > hpB ? 'A' : 'B';
  }
  return aliveA ? 'A' : 'B';
}

/** Применяет решение (ульта + цепочка) для текущей стороны - общая часть playAction/playAiAction. */
function runTurn(state: BattleState, decision: TurnDecision): ActionResult {
  const acting = state.acting;
  const actingTeam = acting === 'A' ? state.teamA : state.teamB;
  const defendingTeam = acting === 'A' ? state.teamB : state.teamA;

  state.turns++;
  const shieldBeforeDecay = actingTeam.shield;
  decayShield(actingTeam);

  const beforeA = snapshotTeam(state.teamA);
  const beforeB = snapshotTeam(state.teamB);

  const damageMult = computeDamageMult(state.turns, state.firstActionDamageMult);
  applyTurnDecision(state.board, actingTeam, defendingTeam, decision, state.rng, damageMult);

  const events: BattleEvent[] = [];
  if (decision.ultimateCasterId) events.push({ type: 'ultimateCast', side: acting, heroId: decision.ultimateCasterId });
  events.push({ type: 'chainResolved', side: acting, chain: decision.chain });
  events.push(...diffTeamEvents('A', beforeA, state.teamA, decision.ultimateCasterId));
  events.push(...diffTeamEvents('B', beforeB, state.teamB, decision.ultimateCasterId));

  const taunter = defendingTeam.heroes.find((h) => h.hp > 0 && h.tauntTurns > 0);
  state.log.push(
    `--- Действие ${state.turns} | ходит ${acting} | множитель урона ${damageMult.toFixed(2)}` +
      (Math.round(shieldBeforeDecay) > 0
        ? ` | распад щита ${acting}: ${Math.round(shieldBeforeDecay)} → ${Math.round(shieldBeforeDecay * SHIELD_RETENTION_PER_TURN)}`
        : ''),
    `  цепочка ${decision.chain.effectiveType} x${decision.chain.cells.length}` +
      `${decision.chain.includesAbilityTile ? ' +звезда' : ''}` +
      `${decision.focusTargetId ? ` | фокус ${decision.focusTargetId}` : ''}`,
    ...(decision.chain.effectiveType === 'sword' && taunter && decision.focusTargetId !== taunter.hero.id
      ? [`  (провокация: удар перехватил ${taunter.hero.id})`]
      : []),
    ...fmtEvents(events)
  );

  state.status = computeStatus(state);
  if (state.status === 'ongoing') state.acting = acting === 'A' ? 'B' : 'A';
  else state.log.push(`=== ИТОГ: ${state.status === 'draw' ? 'ничья' : `победа ${state.status}`} за ${state.turns} действий`);

  return { events, status: state.status };
}

export interface PlayActionInput {
  chain: Chain;
  /** Каст ульты ДО цепочки в этом же ходу (ход не тратится отдельно - см. DESIGN.md). */
  ultimateCasterId?: string;
  focusTargetId?: string;
}

/** Применяет ход текущей стороны (игрока или AI, если вызывается вручную с готовым решением). */
export function playAction(state: BattleState, input: PlayActionInput): ActionResult {
  if (state.status !== 'ongoing') return { events: [], status: state.status };
  return runTurn(state, input);
}

/**
 * Мгновенный каст ульты ВНЕ цепочки (по двойному тапу игрока). Ход не тратится и очередь
 * не передаётся - после каста та же сторона рисует цепочку. Множитель урона - как у
 * предстоящего действия этой стороны (разогрев учтён; на самом первом действии - и монетка).
 */
export function playUltimate(state: BattleState, side: Side, casterId: string, focusTargetId?: string): ActionResult {
  if (state.status !== 'ongoing' || state.acting !== side) return { events: [], status: state.status };
  const actingTeam = side === 'A' ? state.teamA : state.teamB;
  const defendingTeam = side === 'A' ? state.teamB : state.teamA;
  const caster = actingTeam.heroes.find((h) => h.hero.id === casterId && h.hp > 0 && h.charge >= 1);
  if (!caster) return { events: [], status: state.status };

  const beforeA = snapshotTeam(state.teamA);
  const beforeB = snapshotTeam(state.teamB);
  const damageMult = computeDamageMult(state.turns + 1, state.firstActionDamageMult);
  castUltimate(caster, actingTeam, defendingTeam, focusTargetId ?? defaultFocusTarget(defendingTeam), damageMult);

  const events: BattleEvent[] = [
    { type: 'ultimateCast', side, heroId: casterId },
    ...diffTeamEvents('A', beforeA, state.teamA, casterId),
    ...diffTeamEvents('B', beforeB, state.teamB, casterId),
  ];
  state.log.push(
    `--- Ульта вне хода | ${side}:${casterId} | множитель урона ${damageMult.toFixed(2)}` +
      (focusTargetId ? ` | фокус ${focusTargetId}` : ''),
    ...fmtEvents(events.slice(1))
  );
  state.status = computeStatus(state);
  if (state.status !== 'ongoing') {
    state.log.push(`=== ИТОГ: ${state.status === 'draw' ? 'ничья' : `победа ${state.status}`} за ${state.turns} действий`);
  }
  return { events, status: state.status };
}

/** Ход AI текущей стороны - решение через decideTurn (ai.ts). */
export function playAiAction(state: BattleState, level: AiLevel): ActionResult {
  if (state.status !== 'ongoing') return { events: [], status: state.status };

  const acting = state.acting;
  const actingTeam = acting === 'A' ? state.teamA : state.teamB;
  const defendingTeam = acting === 'A' ? state.teamB : state.teamA;

  const decision = decideTurn(state.board, actingTeam, defendingTeam, level);
  if (!decision) {
    // На доске нет ни одной матчнутой цепочки (крайний случай) - пропуск хода, как в simulateBattle.
    state.turns++;
    state.acting = acting === 'A' ? 'B' : 'A';
    return { events: [], status: state.status };
  }

  return runTurn(state, decision);
}
