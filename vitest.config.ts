import { defineConfig } from 'vitest/config';

// Отдельный конфиг для vitest - не трогаем vite.config.ts (там VitePWA, не нужен для тестов ядра).
export default defineConfig({
  test: {
    include: ['src/core/**/*.test.ts'],
  },
});
