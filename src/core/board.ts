// Доска 7x7: гравитация + рефилл через RNG. Автокаскады после рефилла НЕ матчатся
// автоматически (design-решение) - resolveChain обрабатывает ровно одну цепочку за вызов,
// вызывающий код (ai.ts / симулятор) сам решает, что делать со следующим ходом.

import { ABILITY_TILE_CHAIN_LENGTH, BOARD_SIZE, MAX_CHAIN_LENGTH, TILE_TYPES } from './config';
import type { Rng } from './rng';
import type { Board, Cell, Chain, ChainResolveResult, CombatTileType, Position, TileType } from './types';

function randomTileType(rng: Rng): TileType {
  return TILE_TYPES[rng.nextInt(TILE_TYPES.length)];
}

export function createBoard(rng: Rng, size: number = BOARD_SIZE): Board {
  const grid: Cell[][] = [];
  for (let row = 0; row < size; row++) {
    const line: Cell[] = [];
    for (let col = 0; col < size; col++) line.push({ type: randomTileType(rng) });
    grid.push(line);
  }
  return { size, grid };
}

const NEIGHBOR_OFFSETS: Position[] = [
  { row: -1, col: -1 }, { row: -1, col: 0 }, { row: -1, col: 1 },
  { row: 0, col: -1 } /*            */, { row: 0, col: 1 },
  { row: 1, col: -1 }, { row: 1, col: 0 }, { row: 1, col: 1 },
];

function neighbors8(board: Board, pos: Position): Position[] {
  const result: Position[] = [];
  for (const off of NEIGHBOR_OFFSETS) {
    const row = pos.row + off.row;
    const col = pos.col + off.col;
    if (row >= 0 && row < board.size && col >= 0 && col < board.size) result.push({ row, col });
  }
  return result;
}

/**
 * Все матчнутые компоненты (8-направленное соседство, один базовый тип, минимум 3 клетки).
 * ability-тайл - wildcard: продлевает цепочку любого базового типа, но сам не открывает новую
 * (компонент всегда стартует от базовой клетки). Если ability-тайл граничит сразу с двумя
 * разными по типу группами, он достаётся той, что просканирована первой (row-major) - реалистичный
 * редкий edge-case на одну доску, не влияющий на баланс.
 */
export function getConnectedComponents(board: Board): Chain[] {
  const size = board.size;
  const visited: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const chains: Chain[] = [];

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (visited[row][col]) continue;
      const startType = board.grid[row][col].type;
      if (startType === 'ability') continue;
      const baseType = startType as CombatTileType;

      const stack: Position[] = [{ row, col }];
      visited[row][col] = true;
      const cells: Position[] = [];
      let includesAbilityTile = false;

      while (stack.length > 0) {
        const pos = stack.pop()!;
        cells.push(pos);
        if (board.grid[pos.row][pos.col].type === 'ability') includesAbilityTile = true;

        for (const n of neighbors8(board, pos)) {
          if (visited[n.row][n.col]) continue;
          const nType = board.grid[n.row][n.col].type;
          if (nType === baseType || nType === 'ability') {
            visited[n.row][n.col] = true;
            stack.push(n);
          }
        }
      }

      if (cells.length >= 3) {
        chains.push({ cells, effectiveType: baseType, includesAbilityTile });
      }
    }
  }

  return chains;
}

/**
 * Обрезает цепочку до MAX_CHAIN_LENGTH. Клетки идут в порядке обхода DFS - любой префикс
 * связен, так что срез остаётся валидной цепочкой. Флаг ability-тайла пересчитывается
 * по оставшимся клеткам.
 */
export function capChain(board: Board, chain: Chain, maxLength: number = MAX_CHAIN_LENGTH): Chain {
  if (chain.cells.length <= maxLength) return chain;
  const cells = chain.cells.slice(0, maxLength);
  const includesAbilityTile = cells.some((pos) => board.grid[pos.row][pos.col].type === 'ability');
  return { cells, effectiveType: chain.effectiveType, includesAbilityTile };
}

/**
 * Резолвит одну цепочку: очищает клетки, гравитация внутри затронутых колонок, рефилл
 * через RNG. Если длина цепочки >= ABILITY_TILE_CHAIN_LENGTH - в один из освободившихся
 * столбцов (верхняя клетка) кладётся ability-тайл вместо случайного.
 */
export function resolveChain(board: Board, chain: Chain, rng: Rng): ChainResolveResult {
  const affectedCols = new Set<number>();
  for (const pos of chain.cells) affectedCols.add(pos.col);

  const working: (Cell | null)[][] = board.grid.map((line) => line.slice());
  for (const pos of chain.cells) working[pos.row][pos.col] = null;

  for (const col of affectedCols) {
    const remaining: Cell[] = [];
    for (let row = 0; row < board.size; row++) {
      const cell = working[row][col];
      if (cell) remaining.push(cell);
    }
    const missing = board.size - remaining.length;
    const fresh: Cell[] = [];
    for (let i = 0; i < missing; i++) fresh.push({ type: randomTileType(rng) });
    const full = [...fresh, ...remaining]; // новые сверху, старые проваливаются вниз
    for (let row = 0; row < board.size; row++) working[row][col] = full[row];
  }

  const spawnedAbilityTile = chain.cells.length >= ABILITY_TILE_CHAIN_LENGTH;
  if (spawnedAbilityTile) {
    const abilityCol = chain.cells[0].col;
    working[0][abilityCol] = { type: 'ability' };
  }

  for (let row = 0; row < board.size; row++) {
    for (let col = 0; col < board.size; col++) {
      board.grid[row][col] = working[row][col]!;
    }
  }

  return { chain, length: chain.cells.length, spawnedAbilityTile };
}
