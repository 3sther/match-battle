// Бой 3v3: урон/лечение/щит от цепочек, заряд и каст ульт. См. docs/DESIGN.md "Бой".

import {
  ABILITY_TILE_CHARGE_BONUS,
  CHARGE_OTHER_ROLE,
  CHARGE_OWN_ROLE,
  DEFENSE_MITIGATION_K,
  FACTION_COUNTER_BONUS,
  FACTION_COUNTERS,
  HEAL_OVERFLOW_TO_SHIELD,
  HEART_HEAL_BASE_FRACTION,
  OVERCHARGE_BONUS_PER_100,
  SHIELD_DEF_FRACTION,
  SINGLE_HIT_MAX_FRACTION,
  SWORD_POWER,
  TAUNT_TURNS,
  ULTIMATE_POWER,
  chainLengthMultiplier,
} from './config';
import type { Chain, CombatTileType, Faction, Hero, HeroState, TeamState, UltimateType } from './types';

export function createTeamState(heroes: Hero[]): TeamState {
  return {
    heroes: heroes.map((hero) => ({ hero, hp: hero.maxHp, charge: 0, tauntTurns: 0 })),
    shield: 0,
  };
}

export function countersFaction(attacker: Faction, target: Faction): boolean {
  return FACTION_COUNTERS[attacker].includes(target);
}

function mitigation(def: number): number {
  return DEFENSE_MITIGATION_K / (DEFENSE_MITIGATION_K + def);
}

/** Урон меч-цепочки по одной цели: сумма atk живых героев (с фракц. бонусом) × chainMult × mitigation. */
export function computeSwordDamage(actingTeam: TeamState, target: HeroState, chainLength: number): number {
  const mult = chainLengthMultiplier(chainLength);
  const sumAtk = actingTeam.heroes
    .filter((h) => h.hp > 0)
    .reduce((sum, h) => {
      const bonus = countersFaction(h.hero.faction, target.hero.faction) ? 1 + FACTION_COUNTER_BONUS : 1;
      return sum + h.hero.atk * bonus;
    }, 0);
  return sumAtk * SWORD_POWER * mult * mitigation(target.hero.def);
}

/** Наносит урон цели, сначала поглощая его командным щитом цели. */
function dealDamage(defendingTeam: TeamState, target: HeroState, rawDamage: number): void {
  let dmg = rawDamage;
  if (defendingTeam.shield > 0) {
    const absorbed = Math.min(defendingTeam.shield, dmg);
    defendingTeam.shield -= absorbed;
    dmg -= absorbed;
  }
  target.hp = Math.max(0, target.hp - dmg);
}

/** Лечит команду: раненым - больше (масштаб от недостающего HP), излишек уходит в щит. */
function applyHeal(team: TeamState, baseFraction: number, mult: number): void {
  let overflowTotal = 0;
  for (const hs of team.heroes) {
    if (hs.hp <= 0) continue;
    const missingFraction = (hs.hero.maxHp - hs.hp) / hs.hero.maxHp;
    const healAmount = baseFraction * (1 + missingFraction) * hs.hero.maxHp * mult;
    const newHp = Math.min(hs.hero.maxHp, hs.hp + healAmount);
    overflowTotal += hs.hp + healAmount - newHp;
    hs.hp = newHp;
  }
  team.shield += overflowTotal * HEAL_OVERFLOW_TO_SHIELD;
}

function applyShield(team: TeamState, defFraction: number, mult: number): void {
  const sumDef = team.heroes.filter((h) => h.hp > 0).reduce((sum, h) => sum + h.hero.def, 0);
  team.shield += sumDef * defFraction * mult;
}

const CHAIN_TYPE_TO_ROLE: Record<CombatTileType, UltimateType> = {
  sword: 'dd',
  heart: 'support',
  shield: 'tank',
};

/** Заряд ульты за цепочку: своя роль 100%, остальные 40%. */
function applyChainCharge(team: TeamState, effectiveType: CombatTileType): void {
  const chargingRole = CHAIN_TYPE_TO_ROLE[effectiveType];
  for (const hs of team.heroes) {
    if (hs.hp <= 0) continue;
    hs.charge += hs.hero.ultimate.type === chargingRole ? CHARGE_OWN_ROLE : CHARGE_OTHER_ROLE;
  }
}

/** Мгновенный заряд всем живым героям команды при матче цепочки, содержащей ability-тайл. */
function applyAbilityTileBonus(team: TeamState): void {
  for (const hs of team.heroes) {
    if (hs.hp <= 0) continue;
    hs.charge += ABILITY_TILE_CHARGE_BONUS;
  }
}

/** Выбирает цель под меч-удар: провокация танка приоритетнее выбора AI, иначе - фокус-таргет, иначе первый живой. */
function resolveFocusTarget(team: TeamState, focusTargetId?: string): HeroState | undefined {
  const taunter = team.heroes.find((h) => h.hp > 0 && h.tauntTurns > 0);
  if (taunter) return taunter;
  if (focusTargetId) {
    const chosen = team.heroes.find((h) => h.hero.id === focusTargetId && h.hp > 0);
    if (chosen) return chosen;
  }
  return team.heroes.find((h) => h.hp > 0);
}

/**
 * Применяет боевой эффект резолвнутой цепочки (урон/хил/щит) + заряд ульт.
 * damageMult - внешний множитель урона (разогрев затяжного боя), лечение/щит не трогает.
 */
export function applyChain(
  actingTeam: TeamState,
  defendingTeam: TeamState,
  chain: Chain,
  focusTargetId?: string,
  damageMult = 1
): void {
  applyChainCharge(actingTeam, chain.effectiveType);
  if (chain.includesAbilityTile) applyAbilityTileBonus(actingTeam);

  const mult = chainLengthMultiplier(chain.cells.length);
  switch (chain.effectiveType) {
    case 'sword': {
      const target = resolveFocusTarget(defendingTeam, focusTargetId);
      if (target) {
        // Кап «нет ваншотов» - на базовый урон; монетка и разогрев поверх (разогрев обязан
        // пробивать кап, иначе затяжные бои снова не заканчиваются).
        const base = Math.min(
          computeSwordDamage(actingTeam, target, chain.cells.length),
          target.hero.maxHp * SINGLE_HIT_MAX_FRACTION
        );
        dealDamage(defendingTeam, target, base * damageMult);
        if (target.tauntTurns > 0) target.tauntTurns--;
      }
      break;
    }
    case 'heart':
      applyHeal(actingTeam, HEART_HEAL_BASE_FRACTION, mult);
      break;
    case 'shield':
      applyShield(actingTeam, SHIELD_DEF_FRACTION, mult);
      break;
  }
}

/**
 * Прогноз эффекта цепочки для UI: урон по цели / суммарное лечение / щит для цепочки данной
 * длины. Формулы те же, что применяет applyChain, - только без побочных эффектов.
 */
export function previewChainEffect(
  actingTeam: TeamState,
  defendingTeam: TeamState,
  type: CombatTileType,
  length: number,
  focusTargetId?: string,
  damageMult = 1
): number {
  const mult = chainLengthMultiplier(length);
  switch (type) {
    case 'sword': {
      const target = resolveFocusTarget(defendingTeam, focusTargetId);
      if (!target) return 0;
      // Тот же порядок, что в applyChain: кап базы, множители поверх - число честное.
      const base = Math.min(computeSwordDamage(actingTeam, target, length), target.hero.maxHp * SINGLE_HIT_MAX_FRACTION);
      return base * damageMult;
    }
    case 'heart': {
      let total = 0;
      for (const hs of actingTeam.heroes) {
        if (hs.hp <= 0) continue;
        const missingFraction = (hs.hero.maxHp - hs.hp) / hs.hero.maxHp;
        total += HEART_HEAL_BASE_FRACTION * (1 + missingFraction) * hs.hero.maxHp * mult;
      }
      return total;
    }
    case 'shield': {
      const sumDef = actingTeam.heroes.filter((h) => h.hp > 0).reduce((sum, h) => sum + h.hero.def, 0);
      return sumDef * SHIELD_DEF_FRACTION * mult;
    }
  }
}

/** Кастует ульту героя. Заряд сбрасывается в 0 независимо от исхода. */
export function castUltimate(
  caster: HeroState,
  actingTeam: TeamState,
  defendingTeam: TeamState,
  focusTargetId?: string,
  damageMult = 1
): void {
  const overchargeExcess = Math.max(0, caster.charge - 1.0);
  const overchargeMult = 1 + OVERCHARGE_BONUS_PER_100 * overchargeExcess;
  const power = ULTIMATE_POWER[caster.hero.ultimate.type] * caster.hero.ultimate.power;

  switch (caster.hero.ultimate.type) {
    case 'dd': {
      const target = resolveFocusTarget(defendingTeam, focusTargetId);
      if (target) {
        const bonus = countersFaction(caster.hero.faction, target.hero.faction) ? 1 + FACTION_COUNTER_BONUS : 1;
        // Кап «нет ваншотов» покрывает и overcharge; разогрев/монетка (damageMult) - поверх.
        const base = Math.min(
          caster.hero.atk * power * bonus * overchargeMult * mitigation(target.hero.def),
          target.hero.maxHp * SINGLE_HIT_MAX_FRACTION
        );
        dealDamage(defendingTeam, target, base * damageMult);
      }
      break;
    }
    case 'support':
      applyHeal(actingTeam, power, overchargeMult);
      break;
    case 'tank':
      applyShield(actingTeam, power, overchargeMult);
      caster.tauntTurns = TAUNT_TURNS;
      break;
  }

  caster.charge = 0;
}
