// Общие правила одного хода (одного действия одной стороны) - единая точка правды,
// используемая и headless-симулятором (simulateBattle в index.ts), и пошаговым
// BattleController (controller.ts). Вынесено, чтобы клиент/сервер/симулятор баланса
// не могли разъехаться в поведении «монетки», усталости защиты и распада щита.

import { resolveChain } from './board';
import { applyChain, castUltimate } from './combat';
import { FATIGUE_DECAY_PER_TURN, FATIGUE_START_TURN, SHIELD_RETENTION_PER_TURN } from './config';
import type { Rng } from './rng';
import type { Board, Chain, TeamState } from './types';

/** Распад щита в начале хода команды - щит тактическая защита, а не копилка (см. DESIGN.md). */
export function decayShield(team: TeamState): void {
  team.shield *= SHIELD_RETENTION_PER_TURN;
}

/** Множитель урона хода: «монетка» - штраф самого первого действия боя. */
export function computeDamageMult(turnNumber: number, firstActionDamageMult: number): number {
  return turnNumber === 1 ? firstActionDamageMult : 1;
}

/**
 * «Усталость защиты» (анти-столл, по образцу WoW Mortal Wounds / HS Fatigue): после
 * FATIGUE_START_TURN входящий хил и прирост щита тают линейно до нуля. Бьёт в причину
 * затяжек (перелечивание), не раздувая урон.
 */
export function computeDefenseMult(turnNumber: number): number {
  if (turnNumber <= FATIGUE_START_TURN) return 1;
  return Math.max(0, 1 - (turnNumber - FATIGUE_START_TURN) * FATIGUE_DECAY_PER_TURN);
}

/** Решение на один ход: ульта (опционально) + обязательная цепочка. Общий тип для AI и игрока. */
export interface TurnDecision {
  ultimateCasterId?: string;
  chain: Chain;
  focusTargetId?: string;
  /** Ведущий атаки под меч-цепочку (см. combat.ts resolveStriker). Без него - дефолт по цели. */
  strikerId?: string;
}

/** Применяет решение хода: ульта (если есть, до цепочки - design), затем резолв доски + эффект цепочки. */
export function applyTurnDecision(
  board: Board,
  actingTeam: TeamState,
  defendingTeam: TeamState,
  decision: TurnDecision,
  rng: Rng,
  damageMult: number,
  defenseMult: number
): void {
  if (decision.ultimateCasterId) {
    const caster = actingTeam.heroes.find((h) => h.hero.id === decision.ultimateCasterId && h.hp > 0);
    if (caster) castUltimate(caster, actingTeam, defendingTeam, decision.focusTargetId, damageMult, defenseMult);
  }
  resolveChain(board, decision.chain, rng);
  applyChain(actingTeam, defendingTeam, decision.chain, decision.focusTargetId, decision.strikerId, damageMult, defenseMult);
}
