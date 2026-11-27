import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatStrictJson,
  hasAmbiguousCommentInBareValue,
  tryRepairJsonLocally,
} from '../src/lib/services/jsonRepair.js';

test('repairs malformed JSON and returns strict formatted JSON', () => {
  assert.equal(
    tryRepairJsonLocally('{"name":"JsonStudio" "enabled":true}', 2),
    '{\n  "name": "JsonStudio",\n  "enabled": true\n}',
  );
});

test('preserves unsafe integer precision while repairing', () => {
  const result = tryRepairJsonLocally('{"id":9007199254740993,}', 2);
  assert.match(result ?? '', /9007199254740993/);
  assert.doesNotMatch(result ?? '', /9007199254740992/);
});

test('rejects ambiguous comment markers in bare values', () => {
  const source = '{message:use // as text}';
  assert.equal(hasAmbiguousCommentInBareValue(source), true);
  assert.equal(tryRepairJsonLocally(source, 2), null);
});

test('formats strict JSON without rounding precise numbers', () => {
  assert.equal(
    formatStrictJson('{"id":9007199254740993}', 2),
    '{\n  "id": 9007199254740993\n}',
  );
});
