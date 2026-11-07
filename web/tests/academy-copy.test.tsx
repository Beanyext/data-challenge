import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { academyCopy, a } from '../react/academy/copy';
import { setLocale } from '../react/i18n';

test('Academy interface keys, interpolation and all three translations are complete', async () => {
  const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, value] of Object.entries(academyCopy)) {
    for (const locale of ['ru', 'kk', 'en'] as const) {
      assert.ok(value[locale].trim(), `${key}/${locale}`);
      assert.deepEqual(params(value[locale]), params(value.ru), `${key}/${locale} placeholders`);
      setLocale(locale);
      assert.equal(a(key), value[locale]);
    }
    assert.doesNotMatch(value.en, /\p{Script=Cyrillic}/u, `${key} English has no Russian fallback`);
  }
  const source = ts.createSourceFile('AcademyApp.tsx', await readFile('web/react/academy/AcademyApp.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function check(expression: ts.Expression) {
    if (ts.isStringLiteral(expression)) assert.ok(academyCopy[expression.text], `missing UI key: ${expression.text}`);
    if (ts.isConditionalExpression(expression)) { check(expression.whenTrue); check(expression.whenFalse); }
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'a' && node.arguments[0]) check(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const key of ['calm','concerned','irritated','angry','furious','difficulty1','difficulty2','difficulty3','overview','missions','analytics','available','mastered','repeat','locked']) assert.ok(academyCopy[key], `dynamic key: ${key}`);
  for (const key of ['investorLossPrices','investorLossComplaints','investorOrderStatus','investorFees','investorSecurity','investorAdvice']) assert.ok(academyCopy[`${key}Text`], `guidance: ${key}`);
  setLocale('en');
  assert.equal(a('level', { level: 7 }), 'Level 7');
  setLocale('ru');
});
