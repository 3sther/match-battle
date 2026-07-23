// Жадный AI: перебор доступных цепочек на доске, выбор по длине (уровень 1) или по
// полезности (уровень 2). Используется и симулятором баланса, и (позже) PvE-ботом клиента.

import { buildPathChain, getConnectedComponents } from './board';
import { HEART_HEAL_BASE_FRACTION, SHIELD_DEF_FRACTION, defenseLengthMultiplier, swordLengthMultiplier } from './config';
import { computeSwordDamage } from './combat';
import type { Board, Chain, TeamState } from './types';

/** 1 - лёгкий (длина цепочки), 2 - средний (эвристика scoreChain), 3 - сложный (scoreChainHard,
 * реальная ценность действия). Ведущего атаки AI никогда не выбирает явно - работает дефолт
 * resolveStriker (combat.ts): живой герой с максимальным ожидаемым уроном по цели. Ци (см.
 * controller.ts convertTile) AI сознательно не тратит на всех уровнях - только копит. */
export type AiLevel = 1 | 2 | 3;

export interface AiDecision {
  /** Готовая к касту ульта - если есть, кастуется до цепочки хода (design: "ульта не завершает ход"). */
  ultimateCasterId?: string;
  chain: Chain;
  /** Цель под меч-цепочку и под dd-ульту (провокация танка её может переопределить). */
  focusTargetId?: string;
}

function pickFocusTarget(defendingTeam: TeamState): string | undefined {
  const alive = defendingTeam.heroes.filter((h) => h.hp > 0);
  if (alive.length === 0) return undefined;
  // добивание: цель с наименьшим текущим HP
  return alive.reduce((lowest, h) => (h.hp < lowest.hp ? h : lowest)).hero.id;
}

function pickUltimateCaster(actingTeam: TeamState): string | undefined {
  const ready = actingTeam.heroes.filter((h) => h.hp > 0 && h.charge >= 1.0);
  if (ready.length === 0) return undefined;
  // при нескольких готовых ультах кастуем самую перезаряженную (больше overcharge-бонус)
  return ready.reduce((best, h) => (h.charge > best.charge ? h : best)).hero.id;
}

function pickByLength(chains: Chain[]): Chain {
  return chains.reduce((best, c) => (c.cells.length > best.cells.length ? c : best));
}

function scoreChain(chain: Chain, actingTeam: TeamState, defendingTeam: TeamState, focusTargetId?: string): number {
  const mult =
    chain.effectiveType === 'sword'
      ? swordLengthMultiplier(chain.cells.length)
      : defenseLengthMultiplier(chain.cells.length);
  let score = chain.cells.length * mult;
  if (chain.includesAbilityTile) score += 50; // мгновенный заряд всем ультам - весомый бонус

  switch (chain.effectiveType) {
    case 'sword': {
      const target = defendingTeam.heroes.find((h) => h.hero.id === focusTargetId && h.hp > 0);
      if (target) {
        const dmg = computeSwordDamage(actingTeam, target, chain.cells.length);
        if (dmg >= target.hp) score += 1000; // лишающий удар - высший приоритет
      }
      score += mult * 10;
      break;
    }
    case 'heart': {
      const alive = actingTeam.heroes.filter((h) => h.hp > 0);
      const missing = alive.reduce((sum, h) => sum + (h.hero.maxHp - h.hp), 0);
      const totalMax = alive.reduce((sum, h) => sum + h.hero.maxHp, 0);
      const missingRatio = totalMax > 0 ? missing / totalMax : 0;
      score += missingRatio * 30; // чем сильнее недолечена команда, тем ценнее сердце
      break;
    }
    case 'shield':
      score += 5; // базовая ценность щита - ниже урона/хила по умолчанию
      break;
  }
  return score;
}

function pickByUtility(chains: Chain[], actingTeam: TeamState, defendingTeam: TeamState, focusTargetId?: string): Chain {
  return chains.reduce((best, c) => {
    const scoreC = scoreChain(c, actingTeam, defendingTeam, focusTargetId);
    const scoreBest = scoreChain(best, actingTeam, defendingTeam, focusTargetId);
    return scoreC > scoreBest ? c : best;
  });
}

/**
 * Сложный AI (уровень 3): оценивает цепочку РЕАЛЬНОЙ ценностью, а не эвристикой scoreChain.
 * - sword: фактический урон по фокус-цели (дефолтный ведущий - resolveStriker), добивание
 *   приоритетно.
 * - heart: фактически недостающий HP команды - здоровую команду сердце НЕ лечит (score 0).
 * - shield: ценен только когда команда потрёпана (HP < 50%) или угроза велика (суммарный atk
 *   живых врагов) - иначе почти бесполезен, AI его не выберет при наличии альтернативы.
 */
function scoreChainHard(chain: Chain, actingTeam: TeamState, defendingTeam: TeamState, focusTargetId?: string): number {
  switch (chain.effectiveType) {
    case 'sword': {
      const target = defendingTeam.heroes.find((h) => h.hero.id === focusTargetId && h.hp > 0);
      if (!target) return 0;
      const dmg = computeSwordDamage(actingTeam, target, chain.cells.length);
      return dmg + (dmg >= target.hp ? 1000 : 0); // лишающий удар - высший приоритет
    }
    case 'heart': {
      const alive = actingTeam.heroes.filter((h) => h.hp > 0);
      const missingHp = alive.reduce((sum, h) => sum + (h.hero.maxHp - h.hp), 0);
      if (missingHp <= 0) return 0; // команда полностью здорова - лечить нечего
      const mult = defenseLengthMultiplier(chain.cells.length);
      const healPotential = alive.reduce((sum, h) => {
        const missingFraction = (h.hero.maxHp - h.hp) / h.hero.maxHp;
        return sum + HEART_HEAL_BASE_FRACTION * (1 + missingFraction) * h.hero.maxHp * mult;
      }, 0);
      return Math.min(healPotential, missingHp); // ценность не выше реально недостающего HP
    }
    case 'shield': {
      const alive = actingTeam.heroes.filter((h) => h.hp > 0);
      const totalMaxHp = alive.reduce((sum, h) => sum + h.hero.maxHp, 0);
      const totalHp = alive.reduce((sum, h) => sum + h.hp, 0);
      const hpRatio = totalMaxHp > 0 ? totalHp / totalMaxHp : 0;
      const enemyThreat = defendingTeam.heroes.filter((h) => h.hp > 0).reduce((sum, h) => sum + h.hero.atk, 0);
      const lowHp = hpRatio < 0.5;
      const highThreat = enemyThreat > alive.length * 100; // грубый порог "большой суммарный atk"
      if (!lowHp && !highThreat) return chain.cells.length * 0.1; // почти бесполезен, но не строгий 0
      const mult = defenseLengthMultiplier(chain.cells.length);
      const sumDef = alive.reduce((sum, h) => sum + h.hero.def, 0);
      return sumDef * SHIELD_DEF_FRACTION * mult;
    }
  }
}

function pickByHardUtility(chains: Chain[], actingTeam: TeamState, defendingTeam: TeamState, focusTargetId?: string): Chain {
  return chains.reduce((best, c) => {
    const scoreC = scoreChainHard(c, actingTeam, defendingTeam, focusTargetId);
    const scoreBest = scoreChainHard(best, actingTeam, defendingTeam, focusTargetId);
    return scoreC > scoreBest ? c : best;
  });
}

/** Решение AI на один ход. null, если на доске нет ни одной матчнутой цепочки (крайний случай). */
export function decideTurn(board: Board, actingTeam: TeamState, defendingTeam: TeamState, level: AiLevel): AiDecision | null {
  // AI играет ЧЕСТНЫМИ пальце-цепочками: последовательный путь, как протянул бы игрок.
  const chains = getConnectedComponents(board)
    .map((c) => buildPathChain(board, c))
    .filter((c) => c.cells.length >= 3);
  if (chains.length === 0) return null;

  const focusTargetId = pickFocusTarget(defendingTeam);
  const ultimateCasterId = pickUltimateCaster(actingTeam);
  const chain =
    level === 1
      ? pickByLength(chains)
      : level === 2
        ? pickByUtility(chains, actingTeam, defendingTeam, focusTargetId)
        : pickByHardUtility(chains, actingTeam, defendingTeam, focusTargetId);

  return { ultimateCasterId, chain, focusTargetId };
}
