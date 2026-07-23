import { describe, expect, it } from 'vitest';
import { applyChain, castUltimate, createTeamState } from '../combat';
import { simulateBattle } from '../index';
import type { Chain, Hero } from '../types';

function makeHero(id: string, overrides: Partial<Hero> = {}): Hero {
  return {
    id,
    name: id,
    faction: 'fire',
    role: 'dd',
    maxHp: 1000,
    atk: 100,
    def: 50,
    ultimate: { type: 'dd', power: 1 },
    ...overrides,
  } as Hero;
}

function swordChain(length: number): Chain {
  return {
    cells: Array.from({ length }, () => null),
    effectiveType: 'sword',
    includesAbilityTile: false,
  } as unknown as Chain;
}

describe('damageMult (разогрев затяжного боя)', () => {
  it('меч-цепочка наносит ровно вдвое больше при damageMult=2', () => {
    const attacker = () => createTeamState([makeHero('a1')]);
    const defenderA = createTeamState([makeHero('d1')]);
    const defenderB = createTeamState([makeHero('d2')]);

    applyChain(attacker(), defenderA, swordChain(3), 'd1', 1);
    applyChain(attacker(), defenderB, swordChain(3), 'd2', 2);

    const dmgA = 1000 - defenderA.heroes[0].hp;
    const dmgB = 1000 - defenderB.heroes[0].hp;
    expect(dmgA).toBeGreaterThan(0);
    expect(dmgB).toBeCloseTo(dmgA * 2, 6);
  });

  it('dd-ульта наносит ровно вдвое больше при damageMult=2', () => {
    const cast = (mult: number) => {
      const acting = createTeamState([makeHero('a1')]);
      const defending = createTeamState([makeHero('d1')]);
      acting.heroes[0].charge = 1;
      castUltimate(acting.heroes[0], acting, defending, 'd1', mult);
      return 1000 - defending.heroes[0].hp;
    };
    expect(cast(2)).toBeCloseTo(cast(1) * 2, 6);
  });
});

describe('компенсация второго игрока', () => {
  const teamA = [makeHero('a1'), makeHero('a2', { role: 'tank', ultimate: { type: 'tank', power: 1 } }), makeHero('a3')];
  const teamB = [makeHero('b1'), makeHero('b2', { role: 'support', ultimate: { type: 'support', power: 1 } }), makeHero('b3')];

  it('бой детерминирован при явных опциях компенсации', () => {
    const opts = { secondPlayerStartCharge: 0.5, firstActionDamageMult: 0.5 };
    const r1 = simulateBattle(teamA, teamB, 42, opts);
    const r2 = simulateBattle(teamA, teamB, 42, opts);
    expect(r1).toEqual(r2);
  });

  it('компенсация (заряд + малус) снижает перевес первого игрока (80 детерминированных боёв)', () => {
    const winsA = (opts: Parameters<typeof simulateBattle>[3]) => {
      let wins = 0;
      for (let seed = 1; seed <= 80; seed++) {
        if (simulateBattle(teamA, teamB, seed, opts).winner === 'A') wins++;
      }
      return wins;
    };
    const without = winsA({ secondPlayerStartCharge: 0, firstActionDamageMult: 1 });
    const withComp = winsA({ secondPlayerStartCharge: 1, firstActionDamageMult: 0.5 });
    expect(withComp).toBeLessThan(without);
  });
});
