// Симулятор баланса: N боёв AI vs AI на случайных 3v3 составах из тестового ростера.
// Запуск: npx tsx sim/run.ts [--n 1000] [--seed 12345]

import { simulateBattle } from '../src/core/index';
import { FIRST_ACTION_DAMAGE_MULT, MAX_BATTLE_TURNS, SECOND_PLAYER_START_CHARGE } from '../src/core/config';
import { createRng } from '../src/core/rng';
import { generateRoster } from './roster';
import type { Hero } from '../src/core/types';

function parseArgs(): { n: number; seed: number; charge: number; malus: number } {
  const args = process.argv.slice(2);
  let n = 1000;
  let seed = 12345;
  let charge = SECOND_PLAYER_START_CHARGE;
  let malus = FIRST_ACTION_DAMAGE_MULT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--n') n = Number(args[++i]);
    if (args[i] === '--seed') seed = Number(args[++i]);
    if (args[i] === '--charge') charge = Number(args[++i]);
    if (args[i] === '--malus') malus = Number(args[++i]);
  }
  return { n, seed, charge, malus };
}

/** Тянет 3 разных героев из пула без повторов (пул на команду - копия ростера). */
function pickTeam(roster: Hero[], rng: ReturnType<typeof createRng>): Hero[] {
  const pool = [...roster];
  const team: Hero[] = [];
  for (let i = 0; i < 3; i++) {
    const idx = rng.nextInt(pool.length);
    team.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return team;
}

function classifyComposition(team: Hero[]): string {
  const factions = new Set(team.map((h) => h.faction));
  if (factions.size === 1) return 'mono-faction';
  const roles = team
    .map((h) => h.role)
    .sort()
    .join(',');
  if (roles === 'dd,dd,dd') return 'mono-dd';
  if (roles === 'dd,support,tank') return 'balanced';
  return 'mixed';
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

interface WinStat {
  wins: number;
  total: number;
}

function main(): void {
  const { n, seed, charge, malus } = parseArgs();
  const roster = generateRoster();
  const metaRng = createRng(seed);

  const turnsList: number[] = [];
  let firstSideWins = 0;
  let timeouts = 0;
  const archetypeStats = new Map<string, WinStat>();
  const heroStats = new Map<string, WinStat>();
  for (const h of roster) heroStats.set(h.id, { wins: 0, total: 0 });

  for (let i = 0; i < n; i++) {
    const teamA = pickTeam(roster, metaRng);
    const teamB = pickTeam(roster, metaRng);
    const battleSeed = seed + i * 7919 + 1; // детерминированный, но разный на каждый бой

    const result = simulateBattle(teamA, teamB, battleSeed, {
      secondPlayerStartCharge: charge,
      firstActionDamageMult: malus,
    });
    turnsList.push(result.turns);
    if (result.winner === 'A') firstSideWins++;
    if (result.turns >= MAX_BATTLE_TURNS) timeouts++;

    const sides: Array<[Hero[], 'A' | 'B']> = [
      [teamA, 'A'],
      [teamB, 'B'],
    ];
    for (const [team, side] of sides) {
      const archetype = classifyComposition(team);
      const stat = archetypeStats.get(archetype) ?? { wins: 0, total: 0 };
      stat.total++;
      if (result.winner === side) stat.wins++;
      archetypeStats.set(archetype, stat);

      for (const hero of team) {
        const hs = heroStats.get(hero.id)!;
        hs.total++;
        if (result.winner === side) hs.wins++;
      }
    }
  }

  turnsList.sort((a, b) => a - b);
  console.log(`Боёв: ${n}, сид: ${seed}, стартовый заряд B: ${charge}, малус первого удара A: ${malus}`);
  console.log(`Таймауты (>=${MAX_BATTLE_TURNS} ходов): ${((100 * timeouts) / n).toFixed(1)}%`);
  console.log(
    `TTK (ходы): min=${turnsList[0]} p25=${percentile(turnsList, 0.25)} median=${percentile(turnsList, 0.5)} p75=${percentile(turnsList, 0.75)} max=${turnsList[turnsList.length - 1]}`
  );
  console.log(`Винрейт первой команды (A): ${((100 * firstSideWins) / n).toFixed(1)}%`);

  console.log('Винрейты по архетипам состава:');
  for (const [name, stat] of archetypeStats) {
    console.log(`  ${name}: ${((100 * stat.wins) / stat.total).toFixed(1)}% (n=${stat.total})`);
  }

  const heroList = [...heroStats.entries()]
    .map(([id, s]) => ({ id, winRate: s.total ? s.wins / s.total : 0, total: s.total }))
    .sort((a, b) => b.winRate - a.winRate);

  console.log('Топ-5 героев по винрейту:');
  for (const h of heroList.slice(0, 5)) console.log(`  ${h.id}: ${(100 * h.winRate).toFixed(1)}% (n=${h.total})`);

  console.log('Анти-топ-5 героев по винрейту:');
  for (const h of heroList.slice(-5).reverse()) console.log(`  ${h.id}: ${(100 * h.winRate).toFixed(1)}% (n=${h.total})`);
}

main();
