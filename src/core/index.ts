// Публичный API ядра. Собирает доску + AI + бой в полный цикл симуляции матча -
// используется симулятором баланса (sim/run.ts) и, позже, клиентом/сервером (M2/M6-M7).

import { createBoard } from './board';
import { createTeamState } from './combat';
import { decideTurn, type AiLevel } from './ai';
import { createRng } from './rng';
import { applyTurnDecision, computeDamageMult, decayShield } from './turn';
import { FIRST_ACTION_DAMAGE_MULT, MAX_BATTLE_TURNS, SECOND_PLAYER_START_CHARGE } from './config';
import type { Hero, TeamState } from './types';

export * from './types';
export * from './rng';
export * from './config';
export * from './board';
export * from './combat';
export * from './ai';
export * from './turn';

export interface BattleResult {
  winner: 'A' | 'B' | 'draw';
  /** Число отдельных ходов (действий одной из сторон), суммарно за весь бой. */
  turns: number;
}

function isAlive(team: TeamState): boolean {
  return team.heroes.some((h) => h.hp > 0);
}

export interface BattleOptions {
  aiLevelA?: AiLevel;
  aiLevelB?: AiLevel;
  /** Стартовый заряд ульт команды B (компенсация за право второго хода). */
  secondPlayerStartCharge?: number;
  /** Множитель урона первого действия команды A («монетка»). */
  firstActionDamageMult?: number;
}

/** Полный headless-прогон боя 3v3 AI vs AI на общей доске, до полного уничтожения команды. */
export function simulateBattle(
  heroesA: Hero[],
  heroesB: Hero[],
  seed: number,
  opts: BattleOptions = {}
): BattleResult {
  const {
    aiLevelA = 2,
    aiLevelB = 2,
    secondPlayerStartCharge = SECOND_PLAYER_START_CHARGE,
    firstActionDamageMult = FIRST_ACTION_DAMAGE_MULT,
  } = opts;
  const rng = createRng(seed);
  const board = createBoard(rng);
  const teamA = createTeamState(heroesA);
  const teamB = createTeamState(heroesB);
  // Компенсация за право второго хода: команда B стартует с частично заряженными ультами.
  for (const hs of teamB.heroes) hs.charge = secondPlayerStartCharge;

  let turns = 0;
  let acting: 'A' | 'B' = 'A';

  while (isAlive(teamA) && isAlive(teamB) && turns < MAX_BATTLE_TURNS) {
    turns++;
    const actingTeam = acting === 'A' ? teamA : teamB;
    const defendingTeam = acting === 'A' ? teamB : teamA;
    const level = acting === 'A' ? aiLevelA : aiLevelB;

    // Распад щита в начале своего хода: щит - тактическая защита, не копилка.
    decayShield(actingTeam);

    const decision = decideTurn(board, actingTeam, defendingTeam, level);
    if (!decision) {
      acting = acting === 'A' ? 'B' : 'A';
      continue; // на доске нет ни одной матчнутой цепочки - пропуск хода (крайний случай)
    }

    // Разогрев (после ENRAGE_START_TURN) + «монетка» первого действия команды A.
    const damageMult = computeDamageMult(turns, firstActionDamageMult);
    applyTurnDecision(board, actingTeam, defendingTeam, decision, rng, damageMult);

    acting = acting === 'A' ? 'B' : 'A';
  }

  if (turns >= MAX_BATTLE_TURNS) {
    const hpA = teamA.heroes.reduce((sum, h) => sum + h.hp, 0);
    const hpB = teamB.heroes.reduce((sum, h) => sum + h.hp, 0);
    return { winner: hpA === hpB ? 'draw' : hpA > hpB ? 'A' : 'B', turns };
  }
  return { winner: isAlive(teamA) ? 'A' : 'B', turns };
}
