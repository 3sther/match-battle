// DOM-оверлей для просмотра/копирования логов боя. DOM вместо Phaser-текста,
// потому что из Phaser текст не выделить и не скопировать на телефоне.

export function showTextOverlay(text: string): void {
  const existing = document.getElementById('battle-log-overlay');
  if (existing) {
    existing.remove();
    return;
  }
  const wrap = document.createElement('div');
  wrap.id = 'battle-log-overlay';
  wrap.style.cssText =
    'position:fixed;inset:0;background:rgba(13,27,46,.97);z-index:1000;display:flex;flex-direction:column;padding:12px;gap:8px;';
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  ta.style.cssText =
    'flex:1;background:#0d1b2e;color:#cfe0f4;font:12px/1.5 monospace;border:1px solid #d9a94a;border-radius:6px;padding:8px;white-space:pre;overflow:auto;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;';
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Скопировать';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Закрыть';
  for (const b of [copyBtn, closeBtn]) {
    b.style.cssText = 'flex:1;padding:14px;background:#d9a94a;color:#0d1b2e;border:0;border-radius:6px;font-size:16px;';
  }
  copyBtn.onclick = () => {
    ta.select();
    navigator.clipboard?.writeText(ta.value).then(
      () => (copyBtn.textContent = 'Скопировано!'),
      () => document.execCommand('copy')
    );
  };
  closeBtn.onclick = () => wrap.remove();
  row.append(copyBtn, closeBtn);
  wrap.append(ta, row);
  document.body.append(wrap);
}

/** Все сохранённые логи боёв (последние 5, localStorage) одним текстом. */
export function getSavedLogsText(): string {
  try {
    const logs: Array<{ ts: string; log: string[] }> = JSON.parse(localStorage.getItem('mb_battle_logs') ?? '[]');
    if (logs.length === 0) return 'Сохранённых логов пока нет - сыграй бой.';
    return logs.map((entry) => `##### Бой от ${entry.ts}\n${entry.log.join('\n')}`).join('\n\n');
  } catch {
    return 'localStorage недоступен.';
  }
}
