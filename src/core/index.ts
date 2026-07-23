// Публичный API ядра. Собирает доску + AI + бой в полный цикл симуляции матча -
// используется симулятором баланса (sim/run.ts) и, позже, клиентом/сервером (M2/M6-M7).

import { createBoard, resolveChain } from './board';
import { applyChain, castUltimate, createTeamState } from './combat';
import { decideTurn, type AiLevel } from './ai';
import { createRng } from './rng';
import { MAX_BATTLE_TURNS } from './config';
import type { Hero, TeamState } from './types';

export * from './types';
export * from './rng';
export * from './config';
export * from './board';
export * from './combat';
export * from './ai';

export interface BattleResult {
  winner: 'A' | 'B' | 'draw';
  /** Число отдельных ходов (действий одной из сторон), суммарно за весь бой. */
  turns: number;
}

function isAlive(team: TeamState): boolean {
  return team.heroes.some((h) => h.hp > 0);
}

/** Полный headless-прогон боя 3v3 AI vs AI на общей доске, до полного уничтожения команды. */
export function simulateBattle(
  heroesA: Hero[],
  heroesB: Hero[],
  seed: number,
  aiLevelA: AiLevel = 2,
  aiLevelB: AiLevel = 2
): BattleResult {
  const rng = createRng(seed);
  const board = createBoard(rng);
  const teamA = createTeamState(heroesA);
  const teamB = createTeamState(heroesB);

  let turns = 0;
  let acting: 'A' | 'B' = 'A';

  while (isAlive(teamA) && isAlive(teamB) && turns < MAX_BATTLE_TURNS) {
    turns++;
    const actingTeam = acting === 'A' ? teamA : teamB;
    const defendingTeam = acting === 'A' ? teamB : teamA;
    const level = acting === 'A' ? aiLevelA : aiLevelB;

    const decision = decideTurn(board, actingTeam, defendingTeam, level);
    if (!decision) {
      acting = acting === 'A' ? 'B' : 'A';
      continue; // на доске нет ни одной матчнутой цепочки - пропуск хода (крайний случай)
    }

    if (decision.ultimateCasterId) {
      const caster = actingTeam.heroes.find((h) => h.hero.id === decision.ultimateCasterId && h.hp > 0);
      if (caster) castUltimate(caster, actingTeam, defendingTeam, decision.focusTargetId);
    }

    resolveChain(board, decision.chain, rng);
    applyChain(actingTeam, defendingTeam, decision.chain, decision.focusTargetId);

    acting = acting === 'A' ? 'B' : 'A';
  }

  if (turns >= MAX_BATTLE_TURNS) {
    const hpA = teamA.heroes.reduce((sum, h) => sum + h.hp, 0);
    const hpB = teamB.heroes.reduce((sum, h) => sum + h.hp, 0);
    return { winner: hpA === hpB ? 'draw' : hpA > hpB ? 'A' : 'B', turns };
  }
  return { winner: isAlive(teamA) ? 'A' : 'B', turns };
}
