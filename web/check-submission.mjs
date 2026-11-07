#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseDatasetSource } from './submission-source.mjs';
import { validateSubmission } from './submission.mjs';

const USAGE = 'Использование: node web/check-submission.mjs --dataset dev|prod --source /path/original-api.json --input results/dev/results.json';
const FLAGS = new Set(['--dataset', '--source', '--input']);

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!FLAGS.has(flag) || Object.hasOwn(options, flag) || !value || value.startsWith('--')) return null;
    options[flag] = value;
  }
  if (Object.keys(options).length !== FLAGS.size || !['dev', 'prod'].includes(options['--dataset'])) return null;
  return { dataset: options['--dataset'], source: options['--source'], input: options['--input'] };
}

async function readJson(path, label) {
  let bytes;
  try { bytes = await readFile(path); }
  catch { return { error: `Не удалось прочитать ${label}.` }; }
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
    return { document: JSON.parse(content) };
  } catch { return { error: `${label}: требуется корректный UTF-8 JSON.` }; }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error('Ошибка: нужны ровно три разных флага с непустыми значениями; dataset должен быть dev или prod.');
    console.error(USAGE);
    return 2;
  }
  const source = await readJson(options.source, 'исходный файл');
  if (source.error) { console.error(`Ошибка: ${source.error}`); return 2; }
  const input = await readJson(options.input, 'файл результатов');
  if (input.error) { console.error(`Ошибка: ${input.error}`); return 2; }

  let parsed, checked;
  try {
    parsed = parseDatasetSource(source.document, { dataset: options.dataset });
    checked = parsed.errors.length ? { valid: false, errors: [], warnings: [] } :
      validateSubmission(input.document, { dataset: options.dataset, expectedDialogs: parsed.dialogs });
  } catch {
    console.error('Ошибка: не удалось проверить структуру JSON.');
    return 1;
  }
  const errors = [...parsed.errors, ...checked.errors];
  const warnings = [...parsed.warnings, ...checked.warnings];
  const rows = Array.isArray(input.document?.results) ? input.document.results : [];
  const okCount = rows.filter(row => row?.status === 'ok').length;
  const errorCount = rows.filter(row => row?.status === 'error').length;
  const valid = parsed.errors.length === 0 && checked.valid;
  if (valid && errorCount) warnings.push(`есть записи status=error: ${errorCount}; проверьте причины ошибок перед сдачей.`);
  for (const message of errors) console.error(`Ошибка: ${message}`);
  for (const message of warnings) console.warn(`Предупреждение: ${message}`);
  console.log(`Набор: ${options.dataset.toUpperCase()}; исходных диалогов: ${parsed.dialogs.length}; результатов: ${rows.length}; status=ok: ${okCount}; status=error: ${errorCount}.`);
  console.log(`Проверка: ${valid ? 'пройдена' : 'не пройдена'}. Ошибок: ${errors.length}; предупреждений: ${warnings.length}.`);
  return valid ? 0 : 1;
}

process.exitCode = await main();
