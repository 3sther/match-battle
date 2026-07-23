import { describe, expect, it } from 'vitest';
import {
  canExtendChain,
  createBattle,
  getValidChainFromPath,
  playAction,
  playAiAction,
} from '../controller';
import { SHIELD_RETENTION_PER_TURN } from '../config';
import type { Board, Chain, Hero, Position, TileType } from '../types';

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

function team3(prefix: string): Hero[] {
  return [
    makeHero(`${prefix}1`),
    makeHero(`${prefix}2`, { role: 'tank', ultimate: { type: 'tank', power: 1 } }),
    makeHero(`${prefix}3`, { role: 'support', ultimate: { type: 'support', power: 1 } }),
  ];
}

// Доска 4x4 с известной раскладкой типов - для проверки валидации пути.
function fixedBoard(): Board {
  const rows: TileType[][] = [
    ['sword', 'sword', 'sword', 'heart'],
    ['sword', 'shield', 'ability', 'heart'],
    ['heart', 'heart', 'heart', 'shield'],
    ['shield', 'shield', 'shield', 'shield'],
  ];
  return { size: 4, grid: rows.map((row) => row.map((type) => ({ type }))) };
}

// Доска 7x7 из одних мечей - для проверки границ длины (3..MAX_CHAIN_LENGTH=12).
function allSwordBoard(): Board {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => ({ type: 'sword' as TileType })));
  return { size: 7, grid };
}

function snakePath(length: number): Position[] {
  // Змейка по строкам 7x7 - гарантированно соседние (8-направленно) клетки без повторов.
  const path: Position[] = [];
  for (let row = 0; row < 7 && path.length < length; row++) {
    const cols = row % 2 === 0 ? [0, 1, 2, 3, 4, 5, 6] : [6, 5, 4, 3, 2, 1, 0];
    for (const col of cols) {
      if (path.length >= length) break;
      path.push({ row, col });
    }
  }
  return path;
}

describe('getValidChainFromPath - валидация пути игрока', () => {
  const board = fixedBoard();

  it('прямая цепочка одного типа - валидна', () => {
    const chain = getValidChainFromPath(board, [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }]);
    expect(chain).not.toBeNull();
    expect(chain!.effectiveType).toBe('sword');
    expect(chain!.includesAbilityTile).toBe(false);
  });

  it('диагональное соседство - валидно', () => {
    // (1,0) sword -> (0,1) sword (диагональ) -> (0,2) sword
    const chain = getValidChainFromPath(board, [{ row: 1, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }]);
    expect(chain).not.toBeNull();
    expect(chain!.effectiveType).toBe('sword');
  });

  it('разрыв цепочки (клетки не соседние) - невалидно', () => {
    const chain = getValidChainFromPath(board, [{ row: 0, col: 0 }, { row: 0, col: 2 }, { row: 0, col: 1 }]);
    expect(chain).toBeNull();
  });

  it('смешанный тип - невалидно', () => {
    const chain = getValidChainFromPath(board, [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 1 }]);
    expect(chain).toBeNull();
  });

  it('повторная клетка в пути - невалидно', () => {
    const chain = getValidChainFromPath(board, [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 0 },
    ]);
    expect(chain).toBeNull();
  });

  it('ability-тайл - wildcard, продлевает цепочку базового типа', () => {
    // (0,1) sword -> (0,2) sword -> (1,2) ability
    const chain = getValidChainFromPath(board, [{ row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 2 }]);
    expect(chain).not.toBeNull();
    expect(chain!.effectiveType).toBe('sword');
    expect(chain!.includesAbilityTile).toBe(true);
  });

  it('длина < 3 - невалидна', () => {
    const chain = getValidChainFromPath(board, [{ row: 0, col: 0 }, { row: 0, col: 1 }]);
    expect(chain).toBeNull();
  });

  it('длина <= MAX_CHAIN_LENGTH(12) - валидна, > 12 - невалидна', () => {
    const swordBoard = allSwordBoard();
    expect(getValidChainFromPath(swordBoard, snakePath(12))).not.toBeNull();
    expect(getValidChainFromPath(swordBoard, snakePath(13))).toBeNull();
  });

  it('canExtendChain отражает те же правила, что и итоговая валидация', () => {
    expect(canExtendChain(board, [{ row: 0, col: 0 }, { row: 0, col: 1 }], { row: 0, col: 2 })).toBe(true);
    expect(canExtendChain(board, [{ row: 0, col: 0 }, { row: 0, col: 1 }], { row: 1, col: 1 })).toBe(false); // тип не совпадает
    expect(canExtendChain(board, [{ row: 0, col: 0 }], { row: 0, col: 2 })).toBe(false); // не соседняя
  });
});

describe('BattleController - детерминизм', () => {
  it('несколько ходов AI против AI с одним сидом дают идентичный результат', () => {
    const run = () => {
      const state = createBattle(team3('a'), team3('b'), 777);
      playAiAction(state, 2);
      playAiAction(state, 2);
      playAiAction(state, 2);
      return {
        hpA: state.teamA.heroes.map((h) => h.hp),
        hpB: state.teamB.heroes.map((h) => h.hp),
        shieldA: state.teamA.shield,
        shieldB: state.teamB.shield,
        turns: state.turns,
        acting: state.acting,
        status: state.status,
      };
    };
    expect(run()).toEqual(run());
  });
});

describe('BattleController - монетка и распад щита', () => {
  it('первое действие боя получает штраф firstActionDamageMult', () => {
    const chain: Chain = {
      cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
      effectiveType: 'sword',
      includesAbilityTile: false,
    };

    const withCoin = createBattle(team3('a'), team3('b'), 1, { firstActionDamageMult: 0.3 });
    const noCoin = createBattle(team3('a'), team3('b'), 1, { firstActionDamageMult: 1 });

    playAction(withCoin, { chain, focusTargetId: 'b1' });
    playAction(noCoin, { chain, focusTargetId: 'b1' });

    const dmgWithCoin = 1000 - withCoin.teamB.heroes[0].hp;
    const dmgNoCoin = 1000 - noCoin.teamB.heroes[0].hp;
    expect(dmgWithCoin).toBeGreaterThan(0);
    expect(dmgWithCoin).toBeCloseTo(dmgNoCoin * 0.3, 5);
  });

  it('щит команды распадается на SHIELD_RETENTION_PER_TURN к началу её следующего хода', () => {
    const state = createBattle(team3('a'), team3('b'), 2, { firstActionDamageMult: 1 });
    const shieldChainA1: Chain = {
      cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
      effectiveType: 'shield',
      includesAbilityTile: false,
    };
    const shieldChainB: Chain = {
      cells: [{ row: 3, col: 0 }, { row: 3, col: 1 }, { row: 3, col: 2 }],
      effectiveType: 'shield',
      includesAbilityTile: false,
    };
    const shieldChainA2: Chain = {
      cells: [{ row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 }],
      effectiveType: 'shield',
      includesAbilityTile: false,
    };

    playAction(state, { chain: shieldChainA1 }); // ход A - щит с нуля
    const shieldAfterFirstA = state.teamA.shield;
    expect(shieldAfterFirstA).toBeGreaterThan(0);

    playAction(state, { chain: shieldChainB }); // ход B - щита A не касается

    playAction(state, { chain: shieldChainA2 }); // снова ход A - распад ДО нового прироста
    // Состав команды не менялся -> прирост щита за одинаковую цепочку одинаков.
    const expected = shieldAfterFirstA * SHIELD_RETENTION_PER_TURN + shieldAfterFirstA;
    expect(state.teamA.shield).toBeCloseTo(expected, 5);
  });
});
