import Phaser from 'phaser';
import { HomeScene } from './scenes/HomeScene';
import { BattleScene } from './scenes/BattleScene';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 720,
  height: 1280,
  backgroundColor: '#0d1b2e',
  scale: {
    mode: Phaser.Scale.EXPAND,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [HomeScene, BattleScene]
});
