// Все числа баланса - в одном месте. Тюнится по результатам симулятора (sim/run.ts),
// изменения фиксируются в docs/BALANCE_LOG.md.

import type { Faction, TileType, UltimateType } from './types';

export const BOARD_SIZE = 7;

export const TILE_TYPES: TileType[] = ['sword', 'heart', 'shield'];

/** Множители силы цепочки по длине (из первой версии игры, кандидат на тюнинг). */
export const CHAIN_LENGTH_MULTIPLIERS: Record<number, number> = {
  3: 1.0,
  4: 1.1,
  5: 1.25,
  6: 1.4,
  7: 1.6,
  8: 1.8,
};
/** Начиная с этой длины множитель не растёт дальше (8+ = 1.8). */
const CHAIN_LENGTH_MULTIPLIER_CAP = 8;

export function chainLengthMultiplier(length: number): number {
  const capped = Math.min(length, CHAIN_LENGTH_MULTIPLIER_CAP);
  return CHAIN_LENGTH_MULTIPLIERS[capped];
}

/** Длина цепочки, после которой на доску падает ability-тайл. */
export const ABILITY_TILE_CHAIN_LENGTH = 10;

/**
 * Максимальная длина цепочки - правило игры (палец игрока физически не тянет больше)
 * и потолок для AI/симулятора: без него AI матчит компоненты по 20-36 фишек, которых
 * в живой игре не бывает, и баланс считается по фантомным ваншотам.
 */
export const MAX_CHAIN_LENGTH = 12;
/** Мгновенный заряд ульты всем живым героям команды при матче ability-тайла (1.0 = +100%). */
export const ABILITY_TILE_CHARGE_BONUS = 1.0;

/**
 * Смягчение защитой: mitigation = K / (K + def).
 * K=50 подобран так, чтобы def тестового ростера (40-90) давало смягчение ~36-56%,
 * не убивая урон ДД в ноль и не обесценивая танка. Кандидат на тюнинг.
 */
export const DEFENSE_MITIGATION_K = 120;

/** Меч: множитель силы атаки. Итоговый урон = sumAtk(с фракц. бонусом) × chainMult × mitigation. */
export const SWORD_POWER = 4.0;

/** Сердце: базовая доля maxHP лечения на полном HP; раненым - больше (см. combat.ts). */
export const HEART_HEAL_BASE_FRACTION = 0.07;
/** Излишек хила сверх maxHP уходит в командный щит с этим коэффициентом. */
export const HEAL_OVERFLOW_TO_SHIELD = 0.5;

/** Щит: доля суммарного def живых героев команды, уходящая в щит за цепочку. */
export const SHIELD_DEF_FRACTION = 0.3;

/**
 * Доля щита, доживающая до начала СЛЕДУЮЩЕГО своего хода (0.5 = половина распадается).
 * Щит - тактическая защита, а не копилка: без распада симуляция показала вечные
 * танко-стойки со щитами в тысячи HP, которые никто не может пробить.
 */
export const SHIELD_RETENTION_PER_TURN = 0.5;

/** Заряд ульты за цепочку: своя роль получает 100%, остальные - 40% (design-решение). */
export const CHARGE_OWN_ROLE = 1.0;
export const CHARGE_OTHER_ROLE = 0.4;

/** Overcharge: +25% к силе ульты за каждые 100% заряда сверх порога в 100%. */
export const OVERCHARGE_BONUS_PER_100 = 0.25;

/** Фракционный бонус атакующего героя, если его фракция контрит фракцию цели. */
export const FACTION_COUNTER_BONUS = 0.2;

/** Огонь → Дерево → Вода → Огонь; Инь ↔ Ян. attacker контрит все фракции из своего списка. */
export const FACTION_COUNTERS: Record<Faction, Faction[]> = {
  fire: ['wood'],
  wood: ['water'],
  water: ['fire'],
  yin: ['yang'],
  yang: ['yin'],
};

/**
 * Сила эффекта ульт по архетипам (умножается на hero.ultimate.power конкретного героя).
 * dd - множитель к atk кастера; support - доля maxHP как хил; tank - доля def как щит.
 */
export const ULTIMATE_POWER: Record<UltimateType, number> = {
  dd: 1.8,
  support: 0.35,
  tank: 0.8,
};

/** Провокация от танк-ульты держится 1 ход противника (блокирует ровно один входящий меч-удар). */
export const TAUNT_TURNS = 1;

/** Предохранитель симулятора: бой дольше этого числа ходов считается таймаутом (не бесконечный цикл). */
export const MAX_BATTLE_TURNS = 100;

/**
 * Компенсация second-mover advantage: стартовый заряд ульт всех героев второй команды
 * (1.0 = полная ульта). По свипу 2026-07-23 НЕ используется (0): одного малуса первого
 * удара достаточно, а заряд - слишком грубый рычаг. Оставлен как параметр на будущее.
 */
export const SECOND_PLAYER_START_CHARGE = 0;

/**
 * Компенсация первого хода: множитель урона САМОГО ПЕРВОГО действия первой команды
 * (аналог «монетки» Hearthstone). Свип 2026-07-23 (сетка malus × charge, 800 боёв/точка,
 * 2 сида): 0.3 даёт винрейт первого игрока 50.8-51.8% (было 83-85% без компенсации).
 */
export const FIRST_ACTION_DAMAGE_MULT = 0.3;

/** Разогрев против затяжных боёв: после этого хода урон мечей и dd-ульт начинает расти. */
export const ENRAGE_START_TURN = 40;
/** Линейный прирост множителя урона за каждый ход после ENRAGE_START_TURN (+5%/ход). */
export const ENRAGE_DAMAGE_PER_TURN = 0.05;
