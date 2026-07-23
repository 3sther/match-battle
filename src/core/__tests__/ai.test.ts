import { describe, expect, it } from 'vitest';
import { decideTurn } from '../ai';
import { createTeamState } from '../combat';
import type { Board, Hero, TileType } from '../types';

function makeHero(id: string, overrides: Partial<Hero> = {}): Hero {
  return {
    id,
    name: id,
    role: 'dd',
    faction: 'fire',
    maxHp: 1000,
    atk: 100,
    def: 50,
    ultimate: { type: 'dd', power: 1 },
    ...overrides,
  };
}

// Два непересекающихся компонента: сердце (ряд 0) и щит (ряд 2) - ability-заполнители (ряды 1,3)
// примыкают только к "своему" ряду (см. board.ts getConnectedComponents: ability - wildcard,
// но сам компонент не запускает и не сливает разные базовые типы между собой).
function heartVsShieldBoard(): Board {
  const rows: TileType[][] = [
    ['heart', 'heart', 'heart', 'heart'],
    ['ability', 'ability', 'ability', 'ability'],
    ['shield', 'shield', 'shield', 'shield'],
    ['ability', 'ability', 'ability', 'ability'],
  ];
  return { size: 4, grid: rows.map((row) => row.map((type) => ({ type }))) };
}

describe('AI сложный (уровень 3) - реальная ценность действия', () => {
  it('не лечит здоровую команду - выбирает щит вместо бесполезного сердца', () => {
    const board = heartVsShieldBoard();
    const actingTeam = createTeamState([makeHero('a1'), makeHero('a2'), makeHero('a3')]); // полное HP
    const defendingTeam = createTeamState([
      makeHero('b1', { atk: 10 }),
      makeHero('b2', { atk: 10 }),
      makeHero('b3', { atk: 10 }),
    ]); // слабая угроза - щит тоже почти бесполезен, но лечить здоровую команду хуже

    const decision = decideTurn(board, actingTeam, defendingTeam, 3);
    expect(decision).not.toBeNull();
    expect(decision!.chain.effectiveType).toBe('shield');
  });

  it('лечит потрёпанную команду - реальный недостающий HP делает сердце ценнее слабого щита', () => {
    const board = heartVsShieldBoard();
    const actingTeam = createTeamState([makeHero('a1'), makeHero('a2'), makeHero('a3')]);
    for (const hs of actingTeam.heroes) hs.hp = hs.hero.maxHp * 0.3; // сильно потрёпана
    const defendingTeam = createTeamState([
      makeHero('b1', { atk: 10 }),
      makeHero('b2', { atk: 10 }),
      makeHero('b3', { atk: 10 })
    ]);

    const decision = decideTurn(board, actingTeam, defendingTeam, 3);
    expect(decision).not.toBeNull();
    expect(decision!.chain.effectiveType).toBe('heart');
  });
});
