export function errorText(error: unknown): string {
  const message=error instanceof Error?error.message:'Не удалось выполнить действие. Повторите попытку.';
  return /\b(sig|token|api[_-]?key|authorization|password)\b/i.test(message)
    ? 'Ошибка запроса. Подробности с данными доступа скрыты.'
    : message.replace(/https?:\/\/\S+/gi,'[адрес скрыт]').slice(0,300);
}

export function audioUrl(data: { url?: string; audio_url?: string }, demo=false): string {
  const value=data.url || data.audio_url;
  let parsed: URL;
  try { parsed=new URL(String(value || ''),location.href); }
  catch { throw new Error('Сервер передал некорректный адрес аудио.'); }
  if(!value || (!['http:','https:','blob:'].includes(parsed.protocol) && !(demo && /^data:audio\//i.test(value))) || parsed.username || parsed.password) throw new Error('Сервер передал некорректный адрес аудио.');
  return parsed.href;
}

export function navigate(page: string) { location.hash=page; }
