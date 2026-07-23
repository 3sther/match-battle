import Phaser from 'phaser';

// M0 - гейт полноэкранности. Задача сцены: показать на реальном телефоне,
// что игра запускается вертикально, на весь экран, без рамок браузера
// и без чёрных полей (Scale.EXPAND заполняет экран любого соотношения).
export class BootScene extends Phaser.Scene {
  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private btn!: Phaser.GameObjects.Text;
  private frame!: Phaser.GameObjects.Graphics;

  constructor() {
    super('Boot');
  }

  create(): void {
    this.frame = this.add.graphics();

    this.title = this.add
      .text(0, 0, 'MATCH BATTLE', {
        fontFamily: 'Georgia, serif',
        fontSize: '64px',
        color: '#d9a94a'
      })
      .setOrigin(0.5);

    this.subtitle = this.add
      .text(0, 0, 'M0 - проверка полного экрана', {
        fontFamily: 'sans-serif',
        fontSize: '28px',
        color: '#9db4d0'
      })
      .setOrigin(0.5);

    this.info = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffffff',
        align: 'center'
      })
      .setOrigin(0.5);

    this.btn = this.add
      .text(0, 0, 'НА ВЕСЬ ЭКРАН', {
        fontFamily: 'sans-serif',
        fontSize: '36px',
        color: '#0d1b2e',
        backgroundColor: '#d9a94a',
        padding: { x: 40, y: 20 }
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.btn.on('pointerdown', () => {
      if (!this.scale.isFullscreen) {
        this.scale.startFullscreen();
      }
    });

    this.scale.on('resize', () => this.layout());
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.refreshInfo() });
    this.layout();
    this.refreshInfo();
  }

  // Позиции считаются от фактического размера холста, не от дизайн-размера:
  // в EXPAND высота меняется под соотношение экрана устройства.
  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.title.setPosition(w / 2, h * 0.28);
    this.subtitle.setPosition(w / 2, h * 0.28 + 60);
    this.info.setPosition(w / 2, h * 0.5);
    this.btn.setPosition(w / 2, h * 0.72);

    // Золотая рамка по краю холста: если она касается краёв экрана - полей нет.
    this.frame.clear();
    this.frame.lineStyle(6, 0xd9a94a, 0.7);
    this.frame.strokeRect(3, 3, w - 6, h - 6);
  }

  private refreshInfo(): void {
    const standalone =
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: standalone)').matches;
    this.info.setText(
      [
        `окно: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
        `холст: ${Math.round(this.scale.width)}x${Math.round(this.scale.height)}`,
        `PWA-режим: ${standalone ? 'да (без рамок)' : 'нет (вкладка браузера)'}`,
        `fullscreen API: ${this.scale.isFullscreen ? 'активен' : 'нет'}`
      ].join('\n')
    );
  }
}
