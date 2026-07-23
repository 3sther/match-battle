import { describe, expect, it } from 'vitest';
import { applyChain, castUltimate, createTeamState } from '../combat';
import { buildPathChain, createBoard, getConnectedComponents } from '../board';
import { createRng } from '../rng';
import { simulateBattle } from '../index';
import { createBattle, playUltimate } from '../controller';
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

describe('buildPathChain - честные пальце-цепочки AI', () => {
  it('каждая клетка пути соседствует с предыдущей (8 направлений), длина <= 12', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const board = createBoard(createRng(seed));
      for (const component of getConnectedComponents(board)) {
        const path = buildPathChain(board, component);
        expect(path.cells.length).toBeLessThanOrEqual(12);
        for (let i = 1; i < path.cells.length; i++) {
          const a = path.cells[i - 1];
          const b = path.cells[i];
          expect(Math.abs(a.row - b.row)).toBeLessThanOrEqual(1);
          expect(Math.abs(a.col - b.col)).toBeLessThanOrEqual(1);
          expect(a.row === b.row && a.col === b.col).toBe(false);
        }
        // Путь не длиннее компонента и состоит только из его клеток
        const inComponent = new Set(component.cells.map((p) => `${p.row},${p.col}`));
        for (const p of path.cells) expect(inComponent.has(`${p.row},${p.col}`)).toBe(true);
      }
    }
  });
});

describe('playUltimate - ульта вне цепочки', () => {
  it('кастует немедленно, не тратит ход и не передаёт очередь', () => {
    const teamA = [makeHero('a1'), makeHero('a2'), makeHero('a3')];
    const teamB = [makeHero('b1'), makeHero('b2'), makeHero('b3')];
    const state = createBattle(teamA, teamB, 7);
    state.teamA.heroes[0].charge = 1.5;

    const result = playUltimate(state, 'A', 'a1', 'b1');

    expect(result.events.some((e) => e.type === 'ultimateCast' && e.heroId === 'a1')).toBe(true);
    expect(state.teamB.heroes[0].hp).toBeLessThan(1000); // dd-ульта нанесла урон цели
    expect(state.teamA.heroes[0].charge).toBe(0); // заряд сброшен
    expect(state.turns).toBe(0); // ход не потрачен
    expect(state.acting).toBe('A'); // очередь осталась у кастующего
  });

  it('отклоняет каст без заряда и не в свой ход', () => {
    const teamA = [makeHero('a1'), makeHero('a2'), makeHero('a3')];
    const teamB = [makeHero('b1'), makeHero('b2'), makeHero('b3')];
    const state = createBattle(teamA, teamB, 7);

    expect(playUltimate(state, 'A', 'a1').events).toHaveLength(0); // заряд 0
    state.teamB.heroes[0].charge = 1;
    expect(playUltimate(state, 'B', 'b1').events).toHaveLength(0); // не ход B
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
