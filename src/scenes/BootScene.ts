import Phaser from 'phaser';

// M0 - гейт полноэкранности. Задача сцены: показать на реальном телефоне,
// что игра запускается вертикально, на весь экран и без рамок браузера.
export class BootScene extends Phaser.Scene {
  private info!: Phaser.GameObjects.Text;

  constructor() {
    super('Boot');
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height * 0.3, 'MATCH BATTLE', {
        fontFamily: 'Georgia, serif',
        fontSize: '64px',
        color: '#d9a94a'
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.3 + 60, 'M0 - проверка полного экрана', {
        fontFamily: 'sans-serif',
        fontSize: '28px',
        color: '#9db4d0'
      })
      .setOrigin(0.5);

    this.info = this.add
      .text(width / 2, height * 0.5, '', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffffff',
        align: 'center'
      })
      .setOrigin(0.5);

    const btn = this.add
      .text(width / 2, height * 0.7, 'НА ВЕСЬ ЭКРАН', {
        fontFamily: 'sans-serif',
        fontSize: '36px',
        color: '#0d1b2e',
        backgroundColor: '#d9a94a',
        padding: { x: 40, y: 20 }
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    btn.on('pointerdown', () => {
      if (!this.scale.isFullscreen) {
        this.scale.startFullscreen();
      }
    });

    this.time.addEvent({ delay: 500, loop: true, callback: () => this.refreshInfo() });
    this.refreshInfo();
  }

  private refreshInfo(): void {
    const standalone =
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: standalone)').matches;
    this.info.setText(
      [
        `окно: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
        `PWA-режим: ${standalone ? 'да (без рамок)' : 'нет (вкладка браузера)'}`,
        `fullscreen API: ${this.scale.isFullscreen ? 'активен' : 'нет'}`
      ].join('\n')
    );
  }
}
