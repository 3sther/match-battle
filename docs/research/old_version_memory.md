# Anime Match Battle - Project Memory

## Язык общения
- ВСЁ общение с пользователем ведётся на РУССКОМ языке

## Stack
- Phaser 3.90 + Vite 5.4, vanilla JS (ES modules)

## Структура файлов
- `src/main.js` — Phaser init (900x960, Scale.FIT)
- `src/config/constants.js` — конфиги (доска, элементы, 19 персонажей, формулы, уровни, карты)
- `src/config/gameConfig.js` — рантайм конфиг с оверрайдами (localStorage), синглтон GameConfig
- `src/config/rarityConfig.js` — цвета/стили R/SR/SSR/UR
- `src/objects/Board.js` — Match-3: drag-and-connect, гравитация, wildcards, _shining спрайты
- `src/systems/CombatSystem.js` — бой: урон/лечение/щит, ульты с overcharge
- `src/systems/ObstacleSystem.js` — монолиты, цепи, облака (персистентное направление)
- `src/systems/AISystem.js` — жадный AI (Warnsdorff), 3 уровня, async
- `src/systems/LevelSystem.js` — прогрессия, баффы, экипировка бонусы
- `src/systems/GachaSystem.js` — гача с pity (60)
- `src/systems/PlayerData.js` — localStorage, инвентарь, билды, pity
- `src/scenes/HomeScene.js` — главный экран: витрина персонажей, навигация, кнопка "В бой"
- `src/scenes/BattleScene.js` — UI: портреты, бары, бонусы, AI, HTML лог
- `src/scenes/DifficultyScene.js` — выбор сложности (4 уровня: easy/normal/hard/extreme)
- `src/scenes/CharSelectScene.js` — выбор персонажа (locked показывает шарды)
- `src/scenes/CardSelectScene.js` — roguelike карты после победы
- `src/scenes/HeroesScene.js` — каталог героев + детальная карточка (статы/экип/скины)
- `src/scenes/GachaScene.js` — призыв с pity-счётчиком
- `src/scenes/InventoryScene.js` — экипировка: 3 билда, слоты, руны, сравнение
- `src/scenes/SettingsScene.js` — настройки: 3 таба (Бой/Инвентарь/Герои), полная админ-панель
- `src/ui/overlayMenu.js` — общее нижнее меню для оверлеев
- `assets/elements/` — sword/heart/shield + _chained + _shining варианты

## Персонажи (19)
- R (6): Акане, Такеши, Мико, Дайчи, Кио, Суми
- SR (6): Сакура, Хана, Рику, Аямэ, Кодзи, Мэй
- SSR (5): Рэй, Юки, Кагуя, Рэнджи, Цубаки
- UR (2): Аматэрасу, Цукуёми

## Формулы боя
- Меч: `BASE_ATTACK(15) × mult × (atk/10)` + overflow×1 (cap 4)
- Сердце: `BASE_HEAL(16) × mult` + overflow×1, излишек → щит ×0.5
- Щит: `BASE_SHIELD(8) × mult × (def/5)` + overflow×1 (cap 4)
- Множители: {3:1.0, 4:1.1, 5:1.25, 6:1.4, 7:1.6, 8:1.8}
- Редкость: R=1.0, SR=1.08, SSR=1.17, UR=1.26
- Overcharge: +0.25x за каждые 100% сверх 100% заряда

## Ключевые решения
- Механика: drag-and-connect (НЕ swap)
- Доска: 7x7, CELL_SIZE=84, BOARD_OFFSET_X=156, BOARD_OFFSET_Y=295
- Визуал: тёмные 3D-тайлы, золотая цепочка поверх спрайтов, _shining при выделении
- Лог боя: HTML overlay для выделения текста
- AI: жадный Warnsdorff (O(n²)), async с yield, не фризит UI
- Ульта не завершает ход — после неё игрок делает цепочку
- Облака двигаются персистентно (одно направление, разворот у границ)
- Ассеты персонажей: `assets/characters/{rarity}/{id}/portrait.png`
- Централизованные пути: `src/config/assetPaths.js` — getPortraitPath, getAvatarPath, preloadAllPortraits
- CharSelectScene: 3D-карусель (drag/кнопки) + детальный popup
- HeroesScene: мини-карточки сеткой + детальная карточка с табами (Статы/Экипировка/Скины)
- Промпты для генерации арта: `docs/prompts/` (R/SR/SSR/UR-tier.md, skins.md, ultimate-videos.md)
- GameConfig: боевые параметры читаются через gameConfig.get() вместо прямых импортов констант
- SettingsScene: табы со скроллом, все боевые параметры кнопками -/+/--/++, сброс к дефолтам
- HomeScene: стартовая сцена, витрина 3 персонажей с tween-анимацией (дыхание/покачивание)
- Оверлеи открываются и из HomeScene и из BattleScene (closeScene проверяет isPaused)
- Поток: HomeScene → DifficultyScene → CharSelectScene → BattleScene → CardSelectScene → цикл

## Сессия 2026-03-11

### Облака — спрайт вместо Graphics
- ObstacleSystem.createCloudGraphics() заменён: вместо эллипсов рисуется `cloud.png` из `assets/elements/cloud.png`
- Загрузка `cloud` добавлена в BattleScene.preload()

### HomeScene
- Фон заменён на `bg_homescreen` (вместо bg_landscape)
- Кнопка "В бой" отвязана от навигации: battleBtnY = GAME_HEIGHT-280, навигация на GAME_HEIGHT-170
- Портреты увеличены на 30% (targetW: 280→364)
- Анимации: дыхание 0.8%, покачивание 4px (оригинальные значения — большие вызывают артефакты)

### Гача
- Все 19 персонажей добавлены в GACHA_POOL (были только 6)
- Pity (60 призывов) гарантирует ЦЕЛОГО персонажа SSR/UR (amount=60), а не любой SSR+ дроп
- Pity-счётчик сбрасывается ТОЛЬКО при получении целого персонажа (60 шардов) SSR/UR ранга
- Кнопки "Открыть все"/"Забрать" подняты над нижним меню (GAME_HEIGHT - 60 - 35)

### Ульта — переработка анимации
- CombatSystem.useUltimate() теперь НЕ применяет урон сразу, возвращает {damage, attackerIdx, defenderIdx}
- Новый метод applyUltimateDamage() — вызывается ПОСЛЕ анимации
- Видео: без прозрачности, fade-in, cover-масштабирование на весь экран
- Кнопка "Пропустить >" для скипа видео ульты (depth 26)
- Тряска противника и урон показываются ПОСЛЕ анимации, не до
- AI-ход ждёт завершения ульты через промис (_ultAnimResolve)
- board.isProcessing = true на время ульты

### Настройки — кастомные дефолты
- GameConfig: добавлены customDefaults (localStorage отдельным ключом)
- Кнопка "def" — сброс к пользовательскому дефолту (или оригинальному)
- Кнопка "save" — сохранить текущее значение как дефолт для экспериментов
- Кнопки сброса: "Сбросить изменения" + "Сбросить saved-дефолты" отдельно

### Board — улучшения ввода
- Диагональное соединение: _findNearestAdjacent() ищет ближайшего соседа если pointermove промахнулся
- Застрявший drag: pointerdown сбрасывает предыдущий незавершённый drag
- gameout: отмена drag при выходе курсора за canvas
- resolveChain обёрнут в try-finally (isProcessing всегда сбрасывается)
- Флаг _bonusClickConsumed предотвращает конфликт между кликом бонуса и board pointerdown

### BattleScene
- Кнопка статов "i" рядом с каждым портретом — показывает HP/щит/ATK/DEF/ульту/баффы
- Popup закрывается кликом или ESC

## Баланс ультимейтов (сессия 2026-03-10)
- Overcharge снижен: 0.5x → 0.25x за 100% сверх нормы
- Базовый урон ульт снижен ~25-30% у всех:
  - UR: Цукуёми 135→95, Аматэрасу 115→85
  - SSR: Юки 120→85, Кагуя 110→80, Рэй/Рэнджи 100→75, Цубаки 65→50
  - SR: Рику 105→75, Аямэ 95→70, Сакура 80→60, Кодзи 70→55, Мэй 55→45, Хана 30→25
  - R: Такеши 90→70, Кио 85→65, Акане 60→50, Дайчи 50→40, Мико 40→35, Суми 20→15
