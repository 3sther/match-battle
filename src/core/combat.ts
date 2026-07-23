// Бой 3v3: урон/лечение/щит от цепочек, заряд и каст ульт. См. docs/DESIGN.md "Бой"
// и docs/research/combat_math_balance.md (ресерч формул жанра, 2026-07-24).

import {
  ABILITY_TILE_CHARGE_BONUS,
  ASSIST_DAMAGE_BONUS,
  CHARGE_OTHER_ROLE,
  CHARGE_OWN_ROLE,
  DEF_REDUCTION_DENOMINATOR,
  FACTION_COUNTER_BONUS,
  FACTION_COUNTERS,
  HEART_HEAL_BASE_FRACTION,
  MAX_DEF_REDUCTION,
  OVERCHARGE_BONUS_PER_100,
  SHIELD_DEF_FRACTION,
  SHIELD_MAX_FRACTION,
  SINGLE_HIT_MAX_FRACTION,
  SWORD_POWER,
  TAUNT_TURNS,
  ULTIMATE_POWER,
  defenseLengthMultiplier,
  swordLengthMultiplier,
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

/** Смягчение в духе Idle Heroes: урон × (1 − reduction), reduction линеен по def с капом. */
function defenseFactor(def: number): number {
  return 1 - Math.min(MAX_DEF_REDUCTION, def / DEF_REDUCTION_DENOMINATOR);
}

/**
 * Выбирает ведущего атаки: явно указанный герой (если жив), иначе живой герой с максимальным
 * ОЖИДАЕМЫМ уроном по конкретной цели (atk × фракц. бонус против цели её фракции) - то же
 * правило дефолта использует AI и симулятор (см. ai.ts, где strikerId никогда не передаётся
 * явно - достаточно этого дефолта).
 */
export function resolveStriker(team: TeamState, target: HeroState, strikerId?: string): HeroState | undefined {
  const alive = team.heroes.filter((h) => h.hp > 0);
  if (alive.length === 0) return undefined;
  if (strikerId) {
    const chosen = alive.find((h) => h.hero.id === strikerId);
    if (chosen) return chosen;
  }
  const expectedDamage = (h: HeroState) =>
    h.hero.atk * (countersFaction(h.hero.faction, target.hero.faction) ? 1 + FACTION_COUNTER_BONUS : 1);
  return alive.reduce((best, h) => (expectedDamage(h) > expectedDamage(best) ? h : best));
}

/**
 * Урон меч-цепочки по одной цели: бьёт ТОЛЬКО ведущий (striker) - консистентно с ультами.
 * Каждый живой союзник (кроме ведущего) даёт баф +ASSIST_DAMAGE_BONUS; фракционный бонус -
 * только от фракции ведущего против цели (союзники нейтральны).
 */
export function computeSwordDamage(
  actingTeam: TeamState,
  target: HeroState,
  chainLength: number,
  strikerId?: string
): number {
  const striker = resolveStriker(actingTeam, target, strikerId);
  if (!striker) return 0;
  const mult = swordLengthMultiplier(chainLength);
  const bonus = countersFaction(striker.hero.faction, target.hero.faction) ? 1 + FACTION_COUNTER_BONUS : 1;
  const assistCount = actingTeam.heroes.filter((h) => h.hp > 0 && h.hero.id !== striker.hero.id).length;
  const assistMult = 1 + ASSIST_DAMAGE_BONUS * assistCount;
  return striker.hero.atk * bonus * SWORD_POWER * mult * defenseFactor(target.hero.def) * assistMult;
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

/**
 * Лечит команду: раненым - больше (масштаб от недостающего HP). Оверхил СГОРАЕТ -
 * по ресерчу жанра избыток лечения никогда не конвертируется в другой ресурс.
 * defenseMult - «усталость защиты» (анти-столл), после 30-го хода тает к нулю.
 */
function applyHeal(team: TeamState, baseFraction: number, mult: number, defenseMult: number): void {
  for (const hs of team.heroes) {
    if (hs.hp <= 0) continue;
    const missingFraction = (hs.hero.maxHp - hs.hp) / hs.hero.maxHp;
    const healAmount = baseFraction * (1 + missingFraction) * hs.hero.maxHp * mult * defenseMult;
    hs.hp = Math.min(hs.hero.maxHp, hs.hp + healAmount);
  }
}

/** Кап командного щита: доля от суммарного maxHP живых героев (предсказуемый буфер). */
function shieldCap(team: TeamState): number {
  const aliveMaxHp = team.heroes.filter((h) => h.hp > 0).reduce((sum, h) => sum + h.hero.maxHp, 0);
  return aliveMaxHp * SHIELD_MAX_FRACTION;
}

function applyShield(team: TeamState, defFraction: number, mult: number, defenseMult: number): void {
  const sumDef = team.heroes.filter((h) => h.hp > 0).reduce((sum, h) => sum + h.hero.def, 0);
  team.shield = Math.min(shieldCap(team), team.shield + sumDef * defFraction * mult * defenseMult);
}

const CHAIN_TYPE_TO_ROLE: Record<CombatTileType, UltimateType> = {
  sword: 'dd',
  heart: 'support',
  shield: 'tank',
};

/** Заряд ульты за цепочку: своя роль CHARGE_OWN_ROLE, остальные CHARGE_OTHER_ROLE (ресурс роли!). */
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
export function resolveFocusTarget(team: TeamState, focusTargetId?: string): HeroState | undefined {
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
 * damageMult - «монетка» первого действия; defenseMult - «усталость защиты» (анти-столл).
 */
export function applyChain(
  actingTeam: TeamState,
  defendingTeam: TeamState,
  chain: Chain,
  focusTargetId?: string,
  strikerId?: string,
  damageMult = 1,
  defenseMult = 1
): void {
  applyChainCharge(actingTeam, chain.effectiveType);
  if (chain.includesAbilityTile) applyAbilityTileBonus(actingTeam);

  // У защиты своя, пологая кривая длины (у меча - крутая, внутри computeSwordDamage).
  const mult = defenseLengthMultiplier(chain.cells.length);
  switch (chain.effectiveType) {
    case 'sword': {
      const target = resolveFocusTarget(defendingTeam, focusTargetId);
      if (target) {
        // Кап «нет ваншотов» - на базовый урон; монетка поверх.
        const base = Math.min(
          computeSwordDamage(actingTeam, target, chain.cells.length, strikerId),
          target.hero.maxHp * SINGLE_HIT_MAX_FRACTION
        );
        dealDamage(defendingTeam, target, base * damageMult);
        if (target.tauntTurns > 0) target.tauntTurns--;
      }
      break;
    }
    case 'heart':
      applyHeal(actingTeam, HEART_HEAL_BASE_FRACTION, mult, defenseMult);
      break;
    case 'shield':
      applyShield(actingTeam, SHIELD_DEF_FRACTION, mult, defenseMult);
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
  strikerId?: string,
  damageMult = 1,
  defenseMult = 1
): number {
  const mult = defenseLengthMultiplier(length);
  switch (type) {
    case 'sword': {
      const target = resolveFocusTarget(defendingTeam, focusTargetId);
      if (!target) return 0;
      const base = Math.min(
        computeSwordDamage(actingTeam, target, length, strikerId),
        target.hero.maxHp * SINGLE_HIT_MAX_FRACTION
      );
      return base * damageMult;
    }
    case 'heart': {
      let total = 0;
      for (const hs of actingTeam.heroes) {
        if (hs.hp <= 0) continue;
        const missingFraction = (hs.hero.maxHp - hs.hp) / hs.hero.maxHp;
        total += HEART_HEAL_BASE_FRACTION * (1 + missingFraction) * hs.hero.maxHp * mult * defenseMult;
      }
      return total;
    }
    case 'shield': {
      const sumDef = actingTeam.heroes.filter((h) => h.hp > 0).reduce((sum, h) => sum + h.hero.def, 0);
      const gain = sumDef * SHIELD_DEF_FRACTION * mult * defenseMult;
      return Math.min(gain, Math.max(0, shieldCap(actingTeam) - actingTeam.shield));
    }
  }
}

/** Кастует ульту героя. Заряд сбрасывается в 0 независимо от исхода. */
export function castUltimate(
  caster: HeroState,
  actingTeam: TeamState,
  defendingTeam: TeamState,
  focusTargetId?: string,
  damageMult = 1,
  defenseMult = 1
): void {
  const overchargeExcess = Math.max(0, caster.charge - 1.0);
  const overchargeMult = 1 + OVERCHARGE_BONUS_PER_100 * overchargeExcess;
  const power = ULTIMATE_POWER[caster.hero.ultimate.type] * caster.hero.ultimate.power;

  switch (caster.hero.ultimate.type) {
    case 'dd': {
      const target = resolveFocusTarget(defendingTeam, focusTargetId);
      if (target) {
        const bonus = countersFaction(caster.hero.faction, target.hero.faction) ? 1 + FACTION_COUNTER_BONUS : 1;
        // То же смягчение, что у меча; кап «нет ваншотов» покрывает overcharge.
        const raw = caster.hero.atk * bonus * power * overchargeMult * defenseFactor(target.hero.def);
        const base = Math.min(raw, target.hero.maxHp * SINGLE_HIT_MAX_FRACTION);
        dealDamage(defendingTeam, target, base * damageMult);
      }
      break;
    }
    case 'support':
      applyHeal(actingTeam, power, overchargeMult, defenseMult);
      break;
    case 'tank':
      applyShield(actingTeam, power, overchargeMult, defenseMult);
      caster.tauntTurns = TAUNT_TURNS;
      break;
  }

  caster.charge = 0;
}
