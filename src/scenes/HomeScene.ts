import Phaser from 'phaser';
import { createRng } from '../core/rng';
import { generateRoster } from '../../sim/roster';
import type { Hero } from '../core/types';
import { getSavedLogsText, showTextOverlay } from './logOverlay';

/** Случайно перемешивает тестовый ростер (Фишер-Йетс на сидированном RNG) и режет на 2 команды 3v3. */
export function pickRandomTeams(seed: number): { teamA: Hero[]; teamB: Hero[] } {
  const rng = createRng(seed);
  const shuffled = [...generateRoster()];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { teamA: shuffled.slice(0, 3), teamB: shuffled.slice(3, 6) };
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

// Главный экран: заголовок, кнопка "В БОЙ" (случайные команды 3v3) и внизу мелкая строка
// полноэкранности - унаследовано от старой BootScene (M0-гейт), но уже не отдельная сцена.
export class HomeScene extends Phaser.Scene {
  private title!: Phaser.GameObjects.Text;
  private startBtn!: Phaser.GameObjects.Text;
  private fullscreenInfo!: Phaser.GameObjects.Text;

  constructor() {
    super('Home');
  }

  create(): void {
    this.title = this.add
      .text(0, 0, 'MATCH BATTLE', { fontFamily: 'Georgia, serif', fontSize: '64px', color: '#d9a94a' })
      .setOrigin(0.5);

    this.startBtn = this.add
      .text(0, 0, 'В БОЙ', {
        fontFamily: 'sans-serif',
        fontSize: '40px',
        color: '#0d1b2e',
        backgroundColor: '#d9a94a',
        padding: { x: 48, y: 22 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.startBtn.on('pointerdown', () => {
      const seed = Date.now();
      const { teamA, teamB } = pickRandomTeams(seed);
      this.scene.start('Battle', { heroesA: teamA, heroesB: teamB, seed });
    });

    this.fullscreenInfo = this.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '18px', color: '#6d84a0', align: 'center' })
      .setOrigin(0.5);

    // Дебаг: история логов последних 5 боёв (localStorage) - для верификации баланса.
    this.add
      .text(12, 12, 'ЛОГИ БОЁВ', {
        fontFamily: 'sans-serif', fontSize: '20px', color: '#9db4d0', backgroundColor: '#1a2b45', padding: { x: 10, y: 6 },
      })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => showTextOverlay(getSavedLogsText()));

    this.scale.on('resize', () => this.layout());
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.refreshFullscreenInfo() });
    this.layout();
    this.refreshFullscreenInfo();
  }

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.title.setPosition(w / 2, h * 0.32);
    this.startBtn.setPosition(w / 2, h * 0.5);
    this.fullscreenInfo.setPosition(w / 2, h * 0.94);
  }

  private refreshFullscreenInfo(): void {
    const standalone = isStandalone();
    const label = standalone ? 'PWA-режим: да' : 'PWA-режим: нет (тап - на весь экран)';
    this.fullscreenInfo.setText(label);

    // Кнопка fullscreen только если ещё не в полноэкранном/PWA режиме.
    this.fullscreenInfo.removeAllListeners();
    if (!standalone) {
      this.fullscreenInfo.setInteractive({ useHandCursor: true });
      this.fullscreenInfo.on('pointerdown', () => {
        if (!this.scale.isFullscreen) this.scale.startFullscreen();
      });
    } else {
      this.fullscreenInfo.disableInteractive();
    }
  }
}
