import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 720,
  height: 1280,
  backgroundColor: '#0d1b2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [BootScene]
});
