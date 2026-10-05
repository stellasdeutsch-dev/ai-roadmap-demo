/**
 * Тесты того, что есть только у этого сайта (общий планировщик).
 * Общее ядро проверяется в tests/core.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadmap } from '../js/plan.js';

const base = { name: 'T', university: 'U', program: 'P', degreeLevel: 'магистратура', offerStatus: 'received', funding: 'self' };
const dated = (intakeDate) => buildRoadmap({ ...base, intakeDate }).steps.filter((s) => s.deadline);

test('несуществующий месяц не превращается молча в соседний', () => {
  for (const bad of ['2027-13', '2027-00', '1999-09', '2101-09', '99999-01']) {
    assert.equal(dated(bad).length, 0, `${bad} дал даты вместо «срок неизвестен»`);
  }
});

test('дедлайны считаются назад от месяца начала учёбы', () => {
  const near = dated('2027-09');
  const far = dated('2028-09');
  assert.ok(near.length > 0);
  assert.equal(near.length, far.length);
  near.forEach((s, i) => {
    const shift = (new Date(`${far[i].deadline}T12:00:00`) - new Date(`${s.deadline}T12:00:00`)) / 86400000;
    assert.ok(shift >= 365 && shift <= 366, `${s.id}: сдвиг ${shift} дн. вместо года`);
  });
});
