// Все числа баланса - в одном месте. Тюнится по результатам симулятора (sim/run.ts),
// изменения фиксируются в docs/BALANCE_LOG.md. Модель 2026-07-24 собрана по ресерчу
// боевой математики жанра (docs/research/combat_math_balance.md): PAD / E&P / GoW / AFK Arena.

import type { Faction, TileType, UltimateType } from './types';

export const BOARD_SIZE = 7;

export const TILE_TYPES: TileType[] = ['sword', 'heart', 'shield'];

/** Длина цепочки, после которой на доску падает ability-тайл. */
export const ABILITY_TILE_CHAIN_LENGTH = 10;

/**
 * Максимальная длина цепочки - правило игры (палец игрока физически не тянет больше)
 * и потолок для AI/симулятора.
 */
export const MAX_CHAIN_LENGTH = 12;

/**
 * ДВЕ кривые длины цепочки:
 * - МЕЧ - крутая, почти линейная: x12 бьёт в ~4 раза сильнее x3. Длинная цепочка - событие.
 * - ЗАЩИТА (сердце/щит) - пологая: длина помогает слабо, сустейн не перекрывает урон.
 */
export function swordLengthMultiplier(length: number): number {
  return Math.min(length, MAX_CHAIN_LENGTH) / 6; // x3=0.5, x6=1.0, x12=2.0
}

export function defenseLengthMultiplier(length: number): number {
  return 1 + (Math.min(length, MAX_CHAIN_LENGTH) - 3) * 0.06; // x3=1.0, x12=1.54
}

/**
 * Смягчение по образцу Idle Heroes (reddit-разбор, подтверждён тестами игроков):
 * reduction = min(MAX_DEF_REDUCTION, def / DEF_REDUCTION_DENOMINATOR),
 * урон = sumAtk × SWORD_POWER × swordMult × (1 − reduction).
 * Линейно и предсказуемо: защита цели снижает урон на понятный процент (def 40 → −13%,
 * def 90 → −30%), урон никогда не проваливается в ноль и не взрывается от соотношения статов.
 */
export const DEF_REDUCTION_DENOMINATOR = 300;
export const MAX_DEF_REDUCTION = 0.6;
/** Меч: множитель силы атаки. Итог = sumAtk(с фракц. бонусом) × SWORD_POWER × swordMult × (1−reduction). */
export const SWORD_POWER = 1.8;

/**
 * Правило «нет ваншотов»: один удар (меч-цепочка или dd-ульта) не может снять больше этой
 * доли maxHP цели. Кап применяется к БАЗОВОМУ урону; монетка - поверх.
 */
export const SINGLE_HIT_MAX_FRACTION = 0.7;

/** Сердце: базовая доля maxHP лечения на полном HP; раненым - больше (см. combat.ts).
 * Оверхил СГОРАЕТ (ресерч: ни PAD, ни E&P, ни GoW не конвертируют его в другой ресурс). */
export const HEART_HEAL_BASE_FRACTION = 0.04;

/** Щит: доля суммарного def живых героев команды, уходящая в щит за цепочку. */
export const SHIELD_DEF_FRACTION = 0.2;

/**
 * Кап командного щита - доля от суммарного maxHP ЖИВЫХ героев команды (ресерч: буферы
 * должны быть предсказуемы; безлимитный пул - источник непробиваемых фонтанов).
 */
export const SHIELD_MAX_FRACTION = 0.25;

/**
 * Доля щита, доживающая до начала СЛЕДУЮЩЕГО своего хода (0.5 = половина распадается).
 * Щит - тактическая защита, а не копилка.
 */
export const SHIELD_RETENTION_PER_TURN = 0.5;

/**
 * Экономика зарядов ульт (ресерч: «заряд - ресурс роли, не команды»; E&P заряжает ману
 * ТОЛЬКО от своего цвета, полная ульта - ~3 своих цепочки, у нас так же):
 * своя роль +35% за цепочку (ульта ~каждые 3 своих цепочки), чужие роли - символические 10%.
 */
export const CHARGE_OWN_ROLE = 0.35;
export const CHARGE_OTHER_ROLE = 0.1;
/** Мгновенный заряд всем героям команды при матче ability-тайла (= одна «своя» цепочка). */
export const ABILITY_TILE_CHARGE_BONUS = 0.35;

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
 * dd - множитель к базовому урону; support - доля maxHP как хил; tank - доля def как щит.
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
 * Компенсация second-mover advantage: стартовый заряд ульт второй команды. По свипам не
 * используется (0) - хватает монетки. Оставлен как параметр.
 */
export const SECOND_PLAYER_START_CHARGE = 0;

/**
 * «Монетка»: множитель урона САМОГО ПЕРВОГО действия первой команды. В соло первым ходит
 * AI - монетка на нём. Перепроверяется свипом после каждого изменения кривых.
 */
export const FIRST_ACTION_DAMAGE_MULT = 0.3;

/**
 * Анти-столл: «усталость защиты» вместо разогрева урона (ресерч: WoW Mortal Wounds /
 * HS Fatigue - бить надо в причину столла, то есть в перелечивание, а не раздувать урон).
 * После FATIGUE_START_TURN входящий хил и прирост щита тают на DECAY за ход, до нуля.
 */
export const FATIGUE_START_TURN = 30;
export const FATIGUE_DECAY_PER_TURN = 0.1;
