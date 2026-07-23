import { describe, expect, it } from 'vitest';
import { createBoard, getConnectedComponents, resolveChain } from '../board';
import { createRng } from '../rng';
import type { Board, TileType } from '../types';

function buildBoard(rows: TileType[][]): Board {
  return {
    size: rows.length,
    grid: rows.map((row) => row.map((type) => ({ type }))),
  };
}

describe('board - валидация цепочек', () => {
  it('находит цепочку по диагонали (8-направленное соседство)', () => {
    const board = buildBoard([
      ['sword', 'heart', 'heart'],
      ['heart', 'sword', 'heart'],
      ['heart', 'heart', 'sword'],
    ]);
    const chains = getConnectedComponents(board);
    const swordChain = chains.find((c) => c.effectiveType === 'sword');
    expect(swordChain).toBeDefined();
    expect(swordChain!.cells).toHaveLength(3);
  });

  it('не матчит группу того же типа меньше 3 клеток', () => {
    const board = buildBoard([
      ['sword', 'sword', 'heart'],
      ['heart', 'heart', 'heart'],
      ['heart', 'heart', 'heart'],
    ]);
    const chains = getConnectedComponents(board);
    expect(chains.some((c) => c.effectiveType === 'sword')).toBe(false);
  });

  it('ability-тайл продлевает цепочку любого базового типа (wildcard)', () => {
    const board = buildBoard([
      ['sword', 'ability', 'sword', 'heart'],
      ['heart', 'heart', 'heart', 'heart'],
      ['heart', 'heart', 'heart', 'heart'],
      ['heart', 'heart', 'heart', 'heart'],
    ]);
    const chains = getConnectedComponents(board);
    const swordChain = chains.find((c) => c.effectiveType === 'sword');
    expect(swordChain).toBeDefined();
    expect(swordChain!.cells).toHaveLength(3);
    expect(swordChain!.includesAbilityTile).toBe(true);
  });

  it('не соединяет клетки не по соседству (например, через одну)', () => {
    const board = buildBoard([
      ['sword', 'heart', 'sword'],
      ['heart', 'heart', 'heart'],
      ['sword', 'heart', 'sword'],
    ]);
    const chains = getConnectedComponents(board);
    // 4 угловых sword-клетки не соседствуют друг с другом (между ними heart) - чейнов sword нет
    expect(chains.some((c) => c.effectiveType === 'sword')).toBe(false);
  });
});

describe('board - гравитация и рефилл', () => {
  it('createBoard детерминирован по сиду', () => {
    const boardA = createBoard(createRng(555));
    const boardB = createBoard(createRng(555));
    expect(boardA.grid).toEqual(boardB.grid);
  });

  it('resolveChain детерминирован: одинаковый сид даёт одинаковый результат гравитации/рефилла', () => {
    function run(): Board {
      const rng = createRng(2024);
      const board = createBoard(rng);
      const chains = getConnectedComponents(board);
      expect(chains.length).toBeGreaterThan(0);
      resolveChain(board, chains[0], rng);
      return board;
    }
    const boardA = run();
    const boardB = run();
    expect(boardA.grid).toEqual(boardB.grid);
  });

  it('после resolveChain затронутые колонки не содержат пустот, размер доски не меняется', () => {
    const rng = createRng(11);
    const board = createBoard(rng);
    const chains = getConnectedComponents(board);
    resolveChain(board, chains[0], rng);
    expect(board.grid).toHaveLength(board.size);
    for (const row of board.grid) {
      expect(row).toHaveLength(board.size);
      for (const cell of row) expect(cell.type).toBeDefined();
    }
  });

  it('длинная цепочка (>= ABILITY_TILE_CHAIN_LENGTH) спавнит ability-тайл', () => {
    const board = buildBoard([
      ['sword', 'sword', 'sword', 'sword'],
      ['sword', 'sword', 'sword', 'sword'],
      ['sword', 'sword', 'sword', 'heart'],
      ['heart', 'heart', 'heart', 'heart'],
    ]);
    const chains = getConnectedComponents(board);
    const bigChain = chains.find((c) => c.effectiveType === 'sword')!;
    expect(bigChain.cells.length).toBeGreaterThanOrEqual(10);

    const rng = createRng(1);
    const result = resolveChain(board, bigChain, rng);
    expect(result.spawnedAbilityTile).toBe(true);

    const abilityCol = bigChain.cells[0].col;
    expect(board.grid[0][abilityCol].type).toBe('ability');
  });
});
