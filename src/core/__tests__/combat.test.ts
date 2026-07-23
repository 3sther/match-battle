import { describe, expect, it } from 'vitest';
import {
  applyChain,
  castUltimate,
  computeSwordDamage,
  countersFaction,
  createTeamState,
} from '../combat';
import { simulateBattle } from '../index';
import {
  CHARGE_OTHER_ROLE,
  CHARGE_OWN_ROLE,
  DEFENSE_MITIGATION_K,
  FACTION_COUNTER_BONUS,
  HEART_HEAL_BASE_FRACTION,
  OVERCHARGE_BONUS_PER_100,
  SHIELD_DEF_FRACTION,
  SWORD_POWER,
  chainLengthMultiplier,
} from '../config';
import type { Chain, Hero } from '../types';

function makeHero(overrides: Partial<Hero> = {}): Hero {
  return {
    id: 'h1',
    name: 'Test Hero',
    role: 'dd',
    faction: 'fire',
    maxHp: 1000,
    atk: 100,
    def: 0,
    ultimate: { type: 'dd', power: 1.0 },
    ...overrides,
  };
}

describe('фракционный бонус', () => {
  it('огонь контрит дерево, дерево контрит воду, вода контрит огонь', () => {
    expect(countersFaction('fire', 'wood')).toBe(true);
    expect(countersFaction('wood', 'water')).toBe(true);
    expect(countersFaction('water', 'fire')).toBe(true);
    expect(countersFaction('fire', 'water')).toBe(false);
  });

  it('инь и ян контрят друг друга взаимно', () => {
    expect(countersFaction('yin', 'yang')).toBe(true);
    expect(countersFaction('yang', 'yin')).toBe(true);
  });
});

describe('урон меч-цепочки', () => {
  it('без защиты и без фракц. бонуса: sumAtk × SWORD_POWER × chainMult', () => {
    const attacker = makeHero({ id: 'atk', atk: 100, faction: 'fire' });
    const team = createTeamState([attacker]);
    const target = createTeamState([makeHero({ id: 'def', def: 0, faction: 'yin' })]).heroes[0];

    const dmg = computeSwordDamage(team, target, 3);
    const expected = 100 * SWORD_POWER * chainLengthMultiplier(3) * (DEFENSE_MITIGATION_K / DEFENSE_MITIGATION_K);
    expect(dmg).toBeCloseTo(expected, 5);
  });

  it('защита цели смягчает урон по формуле K/(K+def)', () => {
    const attacker = makeHero({ id: 'atk', atk: 100, faction: 'fire' });
    const team = createTeamState([attacker]);
    const target = createTeamState([makeHero({ id: 'def', def: 100, faction: 'water' })]).heroes[0];

    const dmg = computeSwordDamage(team, target, 3);
    const mitigation = DEFENSE_MITIGATION_K / (DEFENSE_MITIGATION_K + 100);
    const expected = 100 * SWORD_POWER * chainLengthMultiplier(3) * mitigation;
    expect(dmg).toBeCloseTo(expected, 5);
  });

  it('фракционный бонус +20% применяется, если атакующий контрит цель', () => {
    const fireAttacker = makeHero({ id: 'fire', atk: 100, faction: 'fire' });
    const teamFire = createTeamState([fireAttacker]);
    const woodTarget = createTeamState([makeHero({ id: 'wood-target', def: 0, faction: 'wood' })]).heroes[0];
    const neutralTarget = createTeamState([makeHero({ id: 'water-target', def: 0, faction: 'water' })]).heroes[0];

    const dmgCountered = computeSwordDamage(teamFire, woodTarget, 3);
    const dmgNeutral = computeSwordDamage(teamFire, neutralTarget, 3);
    expect(dmgCountered).toBeCloseTo(dmgNeutral * (1 + FACTION_COUNTER_BONUS), 5);
  });
});

describe('лечение и щит от цепочек', () => {
  it('раненый герой лечится сильнее здорового (масштаб от недостающего HP)', () => {
    const lightlyHurt = makeHero({ id: 'lightly-hurt', maxHp: 1000 });
    const heavilyHurt = makeHero({ id: 'heavily-hurt', maxHp: 1000 });
    const team = createTeamState([lightlyHurt, heavilyHurt]);
    team.heroes[0].hp = 900; // недостаёт 10%
    team.heroes[1].hp = 500; // недостаёт 50%

    const chain: Chain = { cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], effectiveType: 'heart', includesAbilityTile: false };
    const enemyTeam = createTeamState([makeHero({ id: 'enemy' })]);

    applyChain(team, enemyTeam, chain);

    const mult = chainLengthMultiplier(3);
    const expectedLightGain = HEART_HEAL_BASE_FRACTION * (1 + 0.1) * 1000 * mult;
    const expectedHeavyGain = HEART_HEAL_BASE_FRACTION * (1 + 0.5) * 1000 * mult;
    expect(team.heroes[0].hp - 900).toBeCloseTo(expectedLightGain, 5);
    expect(team.heroes[1].hp - 500).toBeCloseTo(expectedHeavyGain, 5);
    expect(team.heroes[1].hp - 500).toBeGreaterThan(team.heroes[0].hp - 900);
  });

  it('излишек лечения сверх maxHP уходит в командный щит', () => {
    const hero = makeHero({ id: 'full-hp', maxHp: 100 });
    const team = createTeamState([hero]);
    const enemyTeam = createTeamState([makeHero({ id: 'enemy' })]);
    const chain: Chain = { cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], effectiveType: 'heart', includesAbilityTile: false };

    applyChain(team, enemyTeam, chain);

    expect(team.heroes[0].hp).toBe(100); // не выше maxHp
    expect(team.shield).toBeGreaterThan(0); // излишек ушёл в щит
  });

  it('щит-цепочка добавляет sumDef × SHIELD_DEF_FRACTION × chainMult в командный щит', () => {
    const hero = makeHero({ id: 'shield-hero', def: 50 });
    const team = createTeamState([hero]);
    const enemyTeam = createTeamState([makeHero({ id: 'enemy' })]);
    const chain: Chain = { cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], effectiveType: 'shield', includesAbilityTile: false };

    applyChain(team, enemyTeam, chain);

    const expected = 50 * SHIELD_DEF_FRACTION * chainLengthMultiplier(3);
    expect(team.shield).toBeCloseTo(expected, 5);
  });
});

describe('заряд ульты по ролям', () => {
  it('своя роль получает 100%, остальные - 40%', () => {
    const dd = makeHero({ id: 'dd', role: 'dd', ultimate: { type: 'dd', power: 1 } });
    const support = makeHero({ id: 'support', role: 'support', ultimate: { type: 'support', power: 1 } });
    const team = createTeamState([dd, support]);
    const enemyTeam = createTeamState([makeHero({ id: 'enemy' })]);

    const swordChain: Chain = { cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], effectiveType: 'sword', includesAbilityTile: false };
    applyChain(team, enemyTeam, swordChain);

    expect(team.heroes[0].charge).toBeCloseTo(CHARGE_OWN_ROLE, 5); // dd на меч-цепочке - своя роль
    expect(team.heroes[1].charge).toBeCloseTo(CHARGE_OTHER_ROLE, 5); // support - чужая роль
  });

  it('ability-тайл в цепочке даёт мгновенный полный заряд всем живым героям команды', () => {
    const dd = makeHero({ id: 'dd', role: 'dd', ultimate: { type: 'dd', power: 1 } });
    const team = createTeamState([dd]);
    const enemyTeam = createTeamState([makeHero({ id: 'enemy' })]);

    const chain: Chain = { cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], effectiveType: 'shield', includesAbilityTile: true };
    applyChain(team, enemyTeam, chain);

    // 0.4 (чужая роль за shield-чейн) + 1.0 (ability-бонус)
    expect(team.heroes[0].charge).toBeCloseTo(CHARGE_OTHER_ROLE + 1.0, 5);
  });
});

describe('overcharge', () => {
  it('+25% силы ульты за каждые 100% заряда сверх порога в 100%', () => {
    const casterBase = makeHero({ id: 'dd', atk: 100, faction: 'water', ultimate: { type: 'dd', power: 1 } });
    const target = makeHero({ id: 'target', def: 0, faction: 'yin' });

    const teamBase = createTeamState([casterBase]);
    const enemyBase = createTeamState([target]);
    teamBase.heroes[0].charge = 1.0; // ровно 100%, без overcharge
    castUltimate(teamBase.heroes[0], teamBase, enemyBase);
    const baseDamage = target.maxHp - enemyBase.heroes[0].hp;

    const teamOver = createTeamState([casterBase]);
    const enemyOver = createTeamState([{ ...target }]);
    teamOver.heroes[0].charge = 2.0; // 200% - overcharge excess 1.0
    castUltimate(teamOver.heroes[0], teamOver, enemyOver);
    const overDamage = target.maxHp - enemyOver.heroes[0].hp;

    expect(overDamage).toBeCloseTo(baseDamage * (1 + OVERCHARGE_BONUS_PER_100 * 1.0), 5);
  });

  it('каст ульты сбрасывает заряд в 0', () => {
    const caster = makeHero({ ultimate: { type: 'tank', power: 1 } });
    const team = createTeamState([caster]);
    const enemyTeam = createTeamState([makeHero({ id: 'enemy' })]);
    team.heroes[0].charge = 1.5;

    castUltimate(team.heroes[0], team, enemyTeam);

    expect(team.heroes[0].charge).toBe(0);
  });
});

describe('победа/поражение', () => {
  it('симуляция полного боя завершается однозначной победой (не зависает в ничью без причины)', () => {
    const teamA: Hero[] = [
      makeHero({ id: 'a-dd', role: 'dd', faction: 'fire', maxHp: 900, atk: 130, def: 40, ultimate: { type: 'dd', power: 1 } }),
      makeHero({ id: 'a-support', role: 'support', faction: 'fire', maxHp: 1000, atk: 70, def: 55, ultimate: { type: 'support', power: 1 } }),
      makeHero({ id: 'a-tank', role: 'tank', faction: 'fire', maxHp: 1400, atk: 60, def: 90, ultimate: { type: 'tank', power: 1 } }),
    ];
    const teamB: Hero[] = [
      makeHero({ id: 'b-dd', role: 'dd', faction: 'water', maxHp: 900, atk: 130, def: 40, ultimate: { type: 'dd', power: 1 } }),
      makeHero({ id: 'b-support', role: 'support', faction: 'water', maxHp: 1000, atk: 70, def: 55, ultimate: { type: 'support', power: 1 } }),
      makeHero({ id: 'b-tank', role: 'tank', faction: 'water', maxHp: 1400, atk: 60, def: 90, ultimate: { type: 'tank', power: 1 } }),
    ];

    const result = simulateBattle(teamA, teamB, 42);
    expect(['A', 'B']).toContain(result.winner);
    expect(result.turns).toBeGreaterThan(0);
  });

  it('одна и та же пара составов с одним сидом даёт одинаковый результат (детерминизм)', () => {
    const teamA: Hero[] = [makeHero({ id: 'a1' }), makeHero({ id: 'a2' }), makeHero({ id: 'a3' })];
    const teamB: Hero[] = [makeHero({ id: 'b1' }), makeHero({ id: 'b2' }), makeHero({ id: 'b3' })];

    const r1 = simulateBattle(teamA, teamB, 777);
    const r2 = simulateBattle(teamA, teamB, 777);
    expect(r1).toEqual(r2);
  });
});
