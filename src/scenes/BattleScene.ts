import Phaser from 'phaser';
import {
  canExtendChain,
  createBattle,
  defaultFocusTarget,
  getValidChainFromPath,
  playAction,
  playAiAction,
  playUltimate,
  type BattleEvent,
  type BattleState,
} from '../core/controller';
import { decideTurn, type AiLevel } from '../core/ai';
import { previewChainEffect } from '../core/combat';
import { computeDamageMult, computeDefenseMult } from '../core/turn';
import { MAX_CHAIN_LENGTH } from '../core/config';
import type { Chain, CombatTileType, Faction, Hero, HeroState, Position, TileType } from '../core/types';
import { pickRandomTeams } from './HomeScene';
import { showTextOverlay } from './logOverlay';

const CELL_SIZE = 76;
const BOARD_PX = CELL_SIZE * 7;
const AI_LEVEL: AiLevel = 2;

const FACTION_COLOR: Record<Faction, number> = {
  fire: 0xd94a3d,
  wood: 0x4caf50,
  water: 0x3d7dd9,
  yin: 0x8a4fd9,
  yang: 0xd9a94a,
};
const ROLE_LETTER: Record<Hero['role'], string> = { tank: 'Т', dd: 'Д', support: 'С', hybrid: 'Г' };
const DEAD_COLOR = 0x4a4a4a;

interface BattleInitData {
  heroesA: Hero[];
  heroesB: Hero[];
  seed: number;
}

/** Экранное представление одного героя: портрет + HP-бар + шкала ульты. */
interface PortraitView {
  heroId: string;
  side: 'A' | 'B';
  circle: Phaser.GameObjects.Arc;
  roleLabel: Phaser.GameObjects.Text;
  focusRing: Phaser.GameObjects.Arc;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  chargeBarBg: Phaser.GameObjects.Rectangle;
  chargeBarFill: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
}

/**
 * Бой 3v3 против AI на плейсхолдер-арте. Вся боевая логика - в core/controller.ts,
 * сцена только рисует и переводит жесты пальца в вызовы playAction/playAiAction.
 */
export class BattleScene extends Phaser.Scene {
  private state!: BattleState;
  private locked = false; // блокирует ввод игрока во время анимаций/хода AI

  private boardOriginX = 0;
  private boardOriginY = 0;
  private tileGraphics: Phaser.GameObjects.Graphics[][] = [];
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private aiHighlightGraphics!: Phaser.GameObjects.Graphics;

  private dragging = false;
  private dragPath: Position[] = [];
  private dragLabel!: Phaser.GameObjects.Text;

  private portraits: PortraitView[] = [];
  private teamAShieldBar!: Phaser.GameObjects.Rectangle;
  private teamBShieldBar!: Phaser.GameObjects.Rectangle;
  private teamAShieldBarBg!: Phaser.GameObjects.Rectangle;
  private teamBShieldBarBg!: Phaser.GameObjects.Rectangle;

  private focusTargetId?: string;
  /** Для двойного тапа по своему герою (каст ульты). */
  private lastOwnTapHeroId?: string;
  private lastOwnTapTime = 0;

  constructor() {
    super('Battle');
  }

  create(data: BattleInitData): void {
    // Соло-режим: первым ходит AI (сторона B) - «монетка» первого действия ложится на него,
    // а цепочки игрока всегда бьют в полную силу (по плейтесту ослабленный первый ход игрока
    // ощущался как несправедливость, хотя статистически был честен).
    this.state = createBattle(data.heroesA, data.heroesB, data.seed, { firstActing: 'B' });
    this.locked = false;
    this.focusTargetId = undefined;
    this.lastOwnTapHeroId = undefined;
    this.portraits = [];

    this.selectionGraphics = this.add.graphics();
    this.aiHighlightGraphics = this.add.graphics();
    // Одно «красивое число» - прогноз эффекта цепочки, растёт по мере протяжки (фиксировано над доской).
    this.dragLabel = this.add
      .text(0, 0, '', { fontFamily: 'Georgia, serif', fontSize: '44px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setVisible(false);

    this.createBoardGraphics();
    this.createPortraits('B', this.state.teamB.heroes); // враги сверху
    this.createPortraits('A', this.state.teamA.heroes); // своя команда снизу
    this.teamBShieldBarBg = this.add.rectangle(0, 0, 1, 8, 0x1a2b45).setOrigin(0.5);
    this.teamBShieldBar = this.add.rectangle(0, 0, 1, 8, 0x3d7dd9).setOrigin(0, 0.5);
    this.teamAShieldBarBg = this.add.rectangle(0, 0, 1, 8, 0x1a2b45).setOrigin(0.5);
    this.teamAShieldBar = this.add.rectangle(0, 0, 1, 8, 0x3d7dd9).setOrigin(0, 0.5);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.scale.on('resize', () => this.layout());

    // Дебаг-кнопка: полный лог боя (оверлей + копирование). Убрать/спрятать после отладки баланса.
    this.add
      .text(12, 12, 'ЛОГ', {
        fontFamily: 'sans-serif', fontSize: '20px', color: '#9db4d0', backgroundColor: '#1a2b45', padding: { x: 10, y: 6 },
      })
      .setDepth(25)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.showLogOverlay());

    this.layout();
    this.redrawBoard();
    this.refreshHud();

    // AI открывает бой: блокируем ввод и даём ему сделать первый ход.
    if (this.state.acting === 'B') {
      this.locked = true;
      this.time.delayedCall(900, () => this.runAiTurn());
    }
  }

  // ---------------------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------------------

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.boardOriginX = w / 2 - BOARD_PX / 2;
    this.boardOriginY = h * 0.3;

    const enemyY = h * 0.11;
    const ownY = this.boardOriginY + BOARD_PX + 90;
    const xs = [w * 0.22, w * 0.5, w * 0.78];

    for (const view of this.portraits) {
      const y = view.side === 'B' ? enemyY : ownY;
      const idx = this.portraits.filter((v) => v.side === view.side).indexOf(view);
      const x = xs[idx];
      this.positionPortrait(view, x, y);
    }

    this.teamBShieldBarBg.setPosition(w / 2, enemyY + 62);
    this.teamBShieldBarBg.setSize(BOARD_PX * 0.6, 8);
    this.teamBShieldBar.setPosition(w / 2 - (BOARD_PX * 0.6) / 2, enemyY + 62);

    this.teamAShieldBarBg.setPosition(w / 2, ownY - 62);
    this.teamAShieldBarBg.setSize(BOARD_PX * 0.6, 8);
    this.teamAShieldBar.setPosition(w / 2 - (BOARD_PX * 0.6) / 2, ownY - 62);

    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        this.tileGraphics[row][col].setPosition(this.cellCenter({ row, col }).x, this.cellCenter({ row, col }).y);
      }
    }
  }

  private positionPortrait(view: PortraitView, x: number, y: number): void {
    view.x = x;
    view.y = y;
    view.circle.setPosition(x, y);
    view.focusRing.setPosition(x, y);
    view.roleLabel.setPosition(x, y);
    view.hpBarBg.setPosition(x, y + 42);
    view.hpBarFill.setPosition(x - 30, y + 42);
    view.chargeBarBg.setPosition(x, y + 52);
    view.chargeBarFill.setPosition(x - 30, y + 52);
  }

  // ---------------------------------------------------------------------------------------
  // Портреты
  // ---------------------------------------------------------------------------------------

  private createPortraits(side: 'A' | 'B', heroes: HeroState[]): void {
    for (const hs of heroes) {
      const color = FACTION_COLOR[hs.hero.faction];
      const circle = this.add.circle(0, 0, 40, color).setStrokeStyle(3, 0x0d1b2e);
      const focusRing = this.add.circle(0, 0, 46).setStrokeStyle(4, 0xd9a94a, 0).setFillStyle(0, 0);
      const roleLabel = this.add
        .text(0, 0, ROLE_LETTER[hs.hero.role], { fontFamily: 'sans-serif', fontSize: '28px', color: '#0d1b2e' })
        .setOrigin(0.5);
      const hpBarBg = this.add.rectangle(0, 0, 60, 8, 0x1a2b45).setOrigin(0.5);
      const hpBarFill = this.add.rectangle(0, 0, 60, 8, 0x4caf50).setOrigin(0, 0.5);
      const chargeBarBg = this.add.rectangle(0, 0, 60, 5, 0x1a2b45).setOrigin(0.5);
      const chargeBarFill = this.add.rectangle(0, 0, 60, 5, 0xd9a94a).setOrigin(0, 0.5);

      const view: PortraitView = {
        heroId: hs.hero.id,
        side,
        circle,
        roleLabel,
        focusRing,
        hpBarBg,
        hpBarFill,
        chargeBarBg,
        chargeBarFill,
        x: 0,
        y: 0,
      };
      this.portraits.push(view);

      circle.setInteractive({ useHandCursor: true });
      circle.on('pointerdown', () => this.onPortraitTap(view));
    }
  }

  private onPortraitTap(view: PortraitView): void {
    if (this.locked || this.state.status !== 'ongoing') return;
    if (view.side === 'B') {
      const hs = this.state.teamB.heroes.find((h) => h.hero.id === view.heroId);
      if (!hs || hs.hp <= 0) return;
      this.focusTargetId = view.heroId; // ручной выбор фокус-цели
      this.refreshHud();
      return;
    }
    // Своя команда: ДВОЙНОЙ тап по герою с зарядом >=100% кастует ульту немедленно, вне
    // цепочки. Ход при этом не тратится - после ульты игрок рисует цепочку как обычно.
    if (this.state.acting !== 'A') return;
    const hs = this.state.teamA.heroes.find((h) => h.hero.id === view.heroId);
    if (!hs || hs.hp <= 0 || hs.charge < 1) return;

    const now = this.time.now;
    if (this.lastOwnTapHeroId === view.heroId && now - this.lastOwnTapTime < 600) {
      this.lastOwnTapHeroId = undefined;
      const focus = this.focusTargetId ?? defaultFocusTarget(this.state.teamB);
      const result = playUltimate(this.state, 'A', view.heroId, focus);
      this.playEvents(result.events);
      this.refreshHud();
      this.finishIfGameOver(result.status);
      return;
    }
    this.lastOwnTapHeroId = view.heroId;
    this.lastOwnTapTime = now;
    this.flashUltimateArm(view); // первый тап - вспышка-подсказка, второй в течение 0.6с - каст
  }

  private flashUltimateArm(view: PortraitView): void {
    const color = FACTION_COLOR[this.heroById(view.heroId)?.faction ?? 'fire'];
    const flash = this.add.circle(view.x, view.y, 46, color, 0.6);
    this.tweens.add({ targets: flash, alpha: 0, scale: 1.6, duration: 400, onComplete: () => flash.destroy() });
  }

  private heroById(heroId: string): Hero | undefined {
    return (
      this.state.teamA.heroes.find((h) => h.hero.id === heroId)?.hero ??
      this.state.teamB.heroes.find((h) => h.hero.id === heroId)?.hero
    );
  }

  // ---------------------------------------------------------------------------------------
  // Доска - рендер клеток
  // ---------------------------------------------------------------------------------------

  private createBoardGraphics(): void {
    for (let row = 0; row < 7; row++) {
      const line: Phaser.GameObjects.Graphics[] = [];
      for (let col = 0; col < 7; col++) line.push(this.add.graphics());
      this.tileGraphics.push(line);
    }
  }

  private cellCenter(pos: Position): { x: number; y: number } {
    return {
      x: this.boardOriginX + pos.col * CELL_SIZE + CELL_SIZE / 2,
      y: this.boardOriginY + pos.row * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  /**
   * strict=true (протяжка): клетка засчитывается только около центра (радиус 0.42*CELL) -
   * иначе диагональный свайп цепляет угловых соседей, что особенно ломало цепочки через
   * ability-тайл (после него подходит ЛЮБОЙ тип, и случайная клетка убивала задуманный путь).
   */
  private cellAt(x: number, y: number, strict = false): Position | null {
    const col = Math.floor((x - this.boardOriginX) / CELL_SIZE);
    const row = Math.floor((y - this.boardOriginY) / CELL_SIZE);
    if (row < 0 || row >= 7 || col < 0 || col >= 7) return null;
    if (strict) {
      const c = this.cellCenter({ row, col });
      if (Math.hypot(x - c.x, y - c.y) > CELL_SIZE * 0.42) return null;
    }
    return { row, col };
  }

  private redrawBoard(): void {
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        this.drawTile(this.tileGraphics[row][col], this.state.board.grid[row][col].type);
      }
    }
  }

  /** Тайлы без арта - геометрические плейсхолдеры: меч-ромб, сердце-круг, щит-шестиугольник, ability-звезда. */
  private drawTile(g: Phaser.GameObjects.Graphics, type: TileType): void {
    g.clear();
    const r = CELL_SIZE * 0.32;
    switch (type) {
      case 'sword':
        g.fillStyle(0xe08a3d, 1);
        g.fillPoints([{ x: 0, y: -r }, { x: r, y: 0 }, { x: 0, y: r }, { x: -r, y: 0 }] as Phaser.Types.Math.Vector2Like[], true);
        break;
      case 'heart':
        g.fillStyle(0xd94a3d, 1);
        g.fillCircle(0, 0, r);
        break;
      case 'shield': {
        g.fillStyle(0x3d7dd9, 1);
        const pts: Phaser.Types.Math.Vector2Like[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 2;
          pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
        }
        g.fillPoints(pts, true);
        break;
      }
      case 'ability': {
        g.fillStyle(0xd9a94a, 1);
        const pts: Phaser.Types.Math.Vector2Like[] = [];
        for (let i = 0; i < 10; i++) {
          const a = (Math.PI / 5) * i - Math.PI / 2;
          const rad = i % 2 === 0 ? r : r * 0.45;
          pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
        }
        g.fillPoints(pts, true);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Drag-and-connect
  // ---------------------------------------------------------------------------------------

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.locked || this.state.status !== 'ongoing' || this.state.acting !== 'A') return;
    const cell = this.cellAt(p.x, p.y);
    if (!cell) return;
    this.dragging = true;
    this.dragPath = [cell];
    this.redrawSelection();
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    const cell = this.cellAt(p.x, p.y, true);
    if (!cell) return;
    const last = this.dragPath[this.dragPath.length - 1];
    if (last.row === cell.row && last.col === cell.col) return;

    const prev = this.dragPath[this.dragPath.length - 2];
    if (prev && prev.row === cell.row && prev.col === cell.col) {
      this.dragPath.pop(); // возврат на предпоследнюю клетку - откат последнего шага
      this.redrawSelection();
      return;
    }

    if (this.dragPath.length < MAX_CHAIN_LENGTH && canExtendChain(this.state.board, this.dragPath, cell)) {
      this.dragPath.push(cell);
      this.redrawSelection();
    }
  }

  private onPointerUp(_p: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    this.dragging = false;
    const chain = getValidChainFromPath(this.state.board, this.dragPath);
    this.dragPath = [];
    this.redrawSelection();
    if (chain) this.commitPlayerAction(chain);
  }

  private redrawSelection(): void {
    this.selectionGraphics.clear();
    if (this.dragPath.length === 0) {
      this.dragLabel.setVisible(false);
      return;
    }
    this.selectionGraphics.lineStyle(6, 0xffffff, 0.85);
    const pts = this.dragPath.map((pos) => this.cellCenter(pos));
    for (const pt of pts) this.selectionGraphics.strokeCircle(pt.x, pt.y, CELL_SIZE * 0.4);
    this.selectionGraphics.beginPath();
    this.selectionGraphics.moveTo(pts[0].x, pts[0].y);
    for (const pt of pts.slice(1)) this.selectionGraphics.lineTo(pt.x, pt.y);
    this.selectionGraphics.strokePath();

    // Прогноз эффекта цепочки - одно растущее число над доской, цвет по типу цепочки.
    const baseType = this.dragPath
      .map((p) => this.state.board.grid[p.row][p.col].type)
      .find((t) => t !== 'ability') as CombatTileType | undefined;
    if (!baseType) {
      this.dragLabel.setVisible(false);
      return;
    }
    const focus = this.focusTargetId ?? defaultFocusTarget(this.state.teamB);
    this.showChainNumber('A', baseType, this.dragPath.length, focus);
  }

  // ---------------------------------------------------------------------------------------
  // Ход игрока / AI
  // ---------------------------------------------------------------------------------------

  private commitPlayerAction(chain: Chain): void {
    this.locked = true;
    const focusTargetId = this.focusTargetId ?? defaultFocusTarget(this.state.teamB);

    const result = playAction(this.state, { chain, focusTargetId });
    this.redrawBoard();
    this.playEvents(result.events);
    this.refreshHud();

    if (this.finishIfGameOver(result.status)) return;
    this.time.delayedCall(700, () => this.runAiTurn());
  }

  private runAiTurn(): void {
    // Превью решения AI (decideTurn - чистая функция, состояние между превью и применением
    // не меняется). Применяет ход playAiAction - как и требует DESIGN.md.
    const decision = decideTurn(this.state.board, this.state.teamB, this.state.teamA, AI_LEVEL);
    if (!decision) {
      // На доске нет ни одной матчнутой цепочки для AI (крайний случай) - playAiAction пропустит ход.
      const result = playAiAction(this.state, AI_LEVEL);
      this.refreshHud();
      this.locked = false;
      this.finishIfGameOver(result.status);
      return;
    }

    // Игрок видит, как соперник «тянет» цепочку клетка за клеткой - прообраз PvP-трансляции
    // (см. DESIGN.md M7). После полной прорисовки цепочка держится ещё секунду, затем ход.
    const stepMs = Phaser.Math.Clamp(2600 / decision.chain.cells.length, 150, 340);
    this.animateChainDraw(decision.chain, stepMs, decision.focusTargetId, () => {
      this.time.delayedCall(1000, () => {
        this.aiHighlightGraphics.clear();
        this.dragLabel.setVisible(false);
        const result = playAiAction(this.state, AI_LEVEL);
        this.redrawBoard();
        this.playEvents(result.events);
        this.refreshHud();
        this.locked = false;
        this.finishIfGameOver(result.status);
      });
    });
  }

  /** Поклеточная прорисовка цепочки AI + растущее число-прогноз, как при протяжке игрока. */
  private animateChainDraw(chain: Chain, stepMs: number, focusTargetId: string | undefined, onDone: () => void): void {
    const pts = chain.cells.map((pos) => this.cellCenter(pos));
    let shown = 0;
    const g = this.aiHighlightGraphics;
    const drawStep = () => {
      shown++;
      g.clear();
      g.lineStyle(6, 0xd94a3d, 0.9);
      for (const pt of pts.slice(0, shown)) g.strokeCircle(pt.x, pt.y, CELL_SIZE * 0.4);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (const pt of pts.slice(1, shown)) g.lineTo(pt.x, pt.y);
      g.strokePath();
      this.showChainNumber('B', chain.effectiveType, shown, focusTargetId);
      if (shown < pts.length) this.time.delayedCall(stepMs, drawStep);
      else onDone();
    };
    drawStep();
  }

  /** Число-прогноз эффекта цепочки над доской - общее для протяжки игрока и превью AI. */
  private showChainNumber(side: 'A' | 'B', type: CombatTileType, length: number, focusTargetId?: string): void {
    if (length < 3) {
      this.dragLabel.setVisible(false);
      return;
    }
    const actingTeam = side === 'A' ? this.state.teamA : this.state.teamB;
    const defendingTeam = side === 'A' ? this.state.teamB : this.state.teamA;
    const damageMult = computeDamageMult(this.state.turns + 1, this.state.firstActionDamageMult);
    const defenseMult = computeDefenseMult(this.state.turns + 1);
    const amount = previewChainEffect(actingTeam, defendingTeam, type, length, focusTargetId, damageMult, defenseMult);
    const colors: Record<CombatTileType, string> = { sword: '#e08a3d', heart: '#4caf50', shield: '#3d7dd9' };
    this.dragLabel.setPosition(this.boardOriginX + BOARD_PX / 2, this.boardOriginY - 12);
    this.dragLabel.setText(`${side === 'B' ? 'AI: ' : ''}${Math.round(amount)}`);
    this.dragLabel.setColor(colors[type]);
    this.dragLabel.setVisible(true);
  }

  // ---------------------------------------------------------------------------------------
  // События хода -> анимации
  // ---------------------------------------------------------------------------------------

  private playEvents(events: BattleEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'damage':
          this.popupNumber(ev.side, ev.heroId, `-${Math.round(ev.amount)}`, '#e05a4a');
          this.shakePortrait(ev.side, ev.heroId);
          break;
        case 'heal':
          this.popupNumber(ev.side, ev.heroId, `+${Math.round(ev.amount)}`, '#4caf50');
          break;
        case 'shield':
          this.popupTeamNumber(ev.side, `${ev.amount > 0 ? '+' : ''}${Math.round(ev.amount)} щит`, '#3d7dd9');
          break;
        case 'ultimateCast':
          this.flashFaction(ev.side, ev.heroId);
          break;
        default:
          break; // chainResolved / charge - без отдельного попапа (см. controller.ts diffTeamEvents)
      }
    }
  }

  private findPortrait(side: 'A' | 'B', heroId: string): PortraitView | undefined {
    return this.portraits.find((v) => v.side === side && v.heroId === heroId);
  }

  private popupNumber(side: 'A' | 'B', heroId: string, text: string, color: string): void {
    const view = this.findPortrait(side, heroId);
    if (!view) return;
    const label = this.add.text(view.x, view.y - 50, text, { fontFamily: 'sans-serif', fontSize: '26px', color }).setOrigin(0.5);
    this.tweens.add({ targets: label, y: view.y - 90, alpha: 0, duration: 700, onComplete: () => label.destroy() });
  }

  private popupTeamNumber(side: 'A' | 'B', text: string, color: string): void {
    const y = side === 'A' ? this.teamAShieldBar.y : this.teamBShieldBar.y;
    const label = this.add.text(this.scale.width / 2, y - 20, text, { fontFamily: 'sans-serif', fontSize: '22px', color }).setOrigin(0.5);
    this.tweens.add({ targets: label, y: y - 50, alpha: 0, duration: 700, onComplete: () => label.destroy() });
  }

  private shakePortrait(side: 'A' | 'B', heroId: string): void {
    const view = this.findPortrait(side, heroId);
    if (!view) return;
    const baseX = view.x;
    this.tweens.add({ targets: view.circle, x: baseX - 8, duration: 40, yoyo: true, repeat: 3, onComplete: () => view.circle.setX(baseX) });
  }

  private flashFaction(side: 'A' | 'B', heroId: string): void {
    const view = this.findPortrait(side, heroId);
    if (!view) return;
    const flash = this.add.circle(view.x, view.y, 46, FACTION_COLOR[this.heroById(heroId)?.faction ?? 'fire'], 0.7);
    this.tweens.add({ targets: flash, alpha: 0, scale: 1.8, duration: 500, onComplete: () => flash.destroy() });
  }

  // ---------------------------------------------------------------------------------------
  // HUD (HP/заряд/щит/фокус-рамка) - полный ресинк с состоянием боя
  // ---------------------------------------------------------------------------------------

  private refreshHud(): void {
    const effectiveFocus = this.focusTargetId ?? defaultFocusTarget(this.state.teamB);

    for (const view of this.portraits) {
      const team = view.side === 'A' ? this.state.teamA : this.state.teamB;
      const hs = team.heroes.find((h) => h.hero.id === view.heroId);
      if (!hs) continue;

      const alive = hs.hp > 0;
      view.circle.setFillStyle(alive ? FACTION_COLOR[hs.hero.faction] : DEAD_COLOR, alive ? 1 : 0.6);
      // Провокация (танк-ульта): толстая синяя обводка - следующий меч-удар перехватит этот герой.
      view.circle.setStrokeStyle(
        alive && hs.tauntTurns > 0 ? 6 : 3,
        alive && hs.tauntTurns > 0 ? 0x3d7dd9 : 0x0d1b2e
      );

      const hpRatio = Phaser.Math.Clamp(hs.hp / hs.hero.maxHp, 0, 1);
      view.hpBarFill.setSize(60 * hpRatio, 8);
      const chargeRatio = Phaser.Math.Clamp(hs.charge, 0, 1);
      view.chargeBarFill.setSize(60 * chargeRatio, 5);

      // Ульта готова (заряд >=100%) на своей стороне - пульсация портрета.
      if (view.side === 'A' && alive && hs.charge >= 1) {
        if (!this.tweens.isTweening(view.circle)) {
          this.tweens.add({ targets: view.circle, scale: 1.08, duration: 400, yoyo: true, repeat: -1 });
        }
      } else if (this.tweens.isTweening(view.circle)) {
        this.tweens.killTweensOf(view.circle);
        view.circle.setScale(1);
      }

      // Золотая рамка фокус-цели - только у врагов.
      if (view.side === 'B' && alive && view.heroId === effectiveFocus) {
        view.focusRing.setStrokeStyle(4, 0xd9a94a, 1);
      } else {
        view.focusRing.setStrokeStyle(4, 0xd9a94a, 0);
      }
    }

    const shieldScale = (shield: number) => Phaser.Math.Clamp(shield / 400, 0, 1); // 400 - условный "полный" щит для полосы
    this.teamAShieldBar.setSize(BOARD_PX * 0.6 * shieldScale(this.state.teamA.shield), 8);
    this.teamBShieldBar.setSize(BOARD_PX * 0.6 * shieldScale(this.state.teamB.shield), 8);
  }

  // ---------------------------------------------------------------------------------------
  // Конец боя
  // ---------------------------------------------------------------------------------------

  private finishIfGameOver(status: BattleState['status']): boolean {
    if (status === 'ongoing') return false;
    this.saveBattleLog();
    this.showResultOverlay(status);
    return true;
  }

  /** Последние 5 логов боёв - в localStorage (переживают перезапуск игры). */
  private saveBattleLog(): void {
    try {
      const logs: Array<{ ts: string; log: string[] }> = JSON.parse(localStorage.getItem('mb_battle_logs') ?? '[]');
      logs.push({ ts: new Date().toISOString(), log: this.state.log });
      localStorage.setItem('mb_battle_logs', JSON.stringify(logs.slice(-5)));
    } catch {
      // localStorage может быть недоступен (приватный режим) - лог остаётся в памяти боя
    }
  }

  private showLogOverlay(): void {
    showTextOverlay(this.state.log.join('\n'));
  }

  private showResultOverlay(status: BattleState['status']): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const win = status === 'A';
    const label = win ? 'ПОБЕДА' : status === 'draw' ? 'НИЧЬЯ' : 'ПОРАЖЕНИЕ';
    const color = win ? '#d9a94a' : '#9db4d0';

    const bg = this.add.rectangle(w / 2, h / 2, w, h, 0x0d1b2e, 0.85);
    const title = this.add.text(w / 2, h * 0.42, label, { fontFamily: 'Georgia, serif', fontSize: '72px', color }).setOrigin(0.5);
    const retryBtn = this.add
      .text(w / 2, h * 0.55, 'ЕЩЁ РАЗ', {
        fontFamily: 'sans-serif', fontSize: '32px', color: '#0d1b2e', backgroundColor: '#d9a94a', padding: { x: 32, y: 16 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    const homeBtn = this.add
      .text(w / 2, h * 0.63, 'ДОМОЙ', {
        fontFamily: 'sans-serif', fontSize: '32px', color: '#d9a94a', backgroundColor: '#1a2b45', padding: { x: 32, y: 16 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.add.container(0, 0, [bg, title, retryBtn, homeBtn]).setDepth(30);

    retryBtn.on('pointerdown', () => {
      const seed = Date.now();
      const { teamA, teamB } = pickRandomTeams(seed);
      this.scene.restart({ heroesA: teamA, heroesB: teamB, seed });
    });
    homeBtn.on('pointerdown', () => this.scene.start('Home'));
  }
}
