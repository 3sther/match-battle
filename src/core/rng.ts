// Детерминированный seeded RNG. Весь рандом ядра (рефилл доски, тестовые составы
// в симуляторе) идёт ТОЛЬКО через этот интерфейс - иначе баланс нельзя воспроизвести.

export interface Rng {
  /** Случайное число в [0, 1). */
  next(): number;
  /** Случайное целое в [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

/** mulberry32 - маленький быстрый PRNG с хорошим распределением для игровых нужд. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;

  function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(maxExclusive: number): number {
    return Math.floor(next() * maxExclusive);
  }

  return { next, nextInt };
}
