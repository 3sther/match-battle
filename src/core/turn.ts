// Общие правила одного хода (одного действия одной стороны) - единая точка правды,
// используемая и headless-симулятором (simulateBattle в index.ts), и пошаговым
// BattleController (controller.ts). Вынесено, чтобы клиент/сервер/симулятор баланса
// не могли разъехаться в поведении «монетки», разогрева и распада щита.

import { resolveChain } from './board';
import { applyChain, castUltimate } from './combat';
import { ENRAGE_DAMAGE_PER_TURN, ENRAGE_START_TURN, SHIELD_RETENTION_PER_TURN } from './config';
import type { Rng } from './rng';
import type { Board, Chain, TeamState } from './types';

/** Распад щита в начале хода команды - щит тактическая защита, а не копилка (см. DESIGN.md). */
export function decayShield(team: TeamState): void {
  team.shield *= SHIELD_RETENTION_PER_TURN;
}

/** Множитель урона хода: разогрев затяжного боя + компенсация первого действия («монетка»). */
export function computeDamageMult(turnNumber: number, firstActionDamageMult: number): number {
  const enrage = turnNumber > ENRAGE_START_TURN ? 1 + (turnNumber - ENRAGE_START_TURN) * ENRAGE_DAMAGE_PER_TURN : 1;
  const coin = turnNumber === 1 ? firstActionDamageMult : 1;
  return enrage * coin;
}

/** Решение на один ход: ульта (опционально) + обязательная цепочка. Общий тип для AI и игрока. */
export interface TurnDecision {
  ultimateCasterId?: string;
  chain: Chain;
  focusTargetId?: string;
}

/** Применяет решение хода: ульта (если есть, до цепочки - design), затем резолв доски + эффект цепочки. */
export function applyTurnDecision(
  board: Board,
  actingTeam: TeamState,
  defendingTeam: TeamState,
  decision: TurnDecision,
  rng: Rng,
  damageMult: number
): void {
  if (decision.ultimateCasterId) {
    const caster = actingTeam.heroes.find((h) => h.hero.id === decision.ultimateCasterId && h.hp > 0);
    if (caster) castUltimate(caster, actingTeam, defendingTeam, decision.focusTargetId, damageMult);
  }
  resolveChain(board, decision.chain, rng);
  applyChain(actingTeam, defendingTeam, decision.chain, decision.focusTargetId, damageMult);
}
