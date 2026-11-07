// Display-only projection of the existing editor scale; never changes its values.
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function renderScalePreview(scale) {
  const steps = Array.isArray(scale?.steps) ? scale.steps : [];
  if (!steps.length) return '<div class="scale-preview-empty"><strong>Предпросмотр шкалы</strong><p>Добавьте ступени в поле «Ступени шкалы». Здесь появятся баллы и условия.</p></div>';
  return `<table><caption>Предпросмотр шкалы</caption><thead><tr><th scope="col">Балл</th><th scope="col">Условие</th></tr></thead><tbody>${steps.map(step => `<tr><td>${Number.isFinite(step?.value) ? escapeText(step.value) : '<span class="scale-preview-incomplete">Проверьте число</span>'}</td><td>${String(step?.label ?? '').trim() ? escapeText(step.label) : '<span class="scale-preview-incomplete">Добавьте описание</span>'}</td></tr>`).join('')}</tbody></table><p>Текущие ступени из поля «Ступени шкалы».</p>`;
}
