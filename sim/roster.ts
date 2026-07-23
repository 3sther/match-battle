// Тестовый ростер для симулятора баланса M1. НЕ финальный игровой контент (тот - M3,
// китайская мифология по docs/DESIGN.md). Тут только статы по ролям для прогона AI vs AI.
//
// 15 героев: 3 стандартные фракции (fire/wood/water) × 4 роли (tank/dd/support/hybrid) = 12,
// + элитные инь/ян: 2 инь + 1 ян = 3. Итого 15 - как и просили (пропорция инь/ян асимметрична,
// т.к. 12+2 не делится ровно, зафиксировано в docs/BALANCE_LOG.md).

import type { Faction, Hero, Role, UltimateType } from '../src/core/types';

interface RoleStats {
  maxHp: number;
  atk: number;
  def: number;
}

// Базовые статы по роли (кандидаты на тюнинг симулятором).
const ROLE_STATS: Record<Role, RoleStats> = {
  tank: { maxHp: 1400, atk: 60, def: 90 },
  dd: { maxHp: 900, atk: 130, def: 40 },
  support: { maxHp: 1000, atk: 70, def: 55 },
  hybrid: { maxHp: 1050, atk: 95, def: 65 },
};

// Архетип ульты по умолчанию для роли; hybrid в тестовом ростере кастует dd-ульту
// (гибрид "дамажный" - самый частый вариант гибрида в мобильных match-3).
const ROLE_ULTIMATE_TYPE: Record<Role, UltimateType> = {
  tank: 'tank',
  dd: 'dd',
  support: 'support',
  hybrid: 'dd',
};

function makeHero(id: string, faction: Faction, role: Role): Hero {
  const stats = ROLE_STATS[role];
  return {
    id,
    name: id,
    role,
    faction,
    maxHp: stats.maxHp,
    atk: stats.atk,
    def: stats.def,
    ultimate: { type: ROLE_ULTIMATE_TYPE[role], power: 1.0 },
  };
}

export function generateRoster(): Hero[] {
  const roster: Hero[] = [];
  const standardFactions: Faction[] = ['fire', 'wood', 'water'];
  const roles: Role[] = ['tank', 'dd', 'support', 'hybrid'];

  for (const faction of standardFactions) {
    for (const role of roles) {
      roster.push(makeHero(`${faction}_${role}`, faction, role));
    }
  }

  // Инь/Ян - элитная пара, только основные боевые роли (без hybrid, см. DESIGN.md "Ростер").
  roster.push(makeHero('yin_tank', 'yin', 'tank'));
  roster.push(makeHero('yin_dd', 'yin', 'dd'));
  roster.push(makeHero('yang_support', 'yang', 'support'));

  return roster; // 12 + 3 = 15
}
