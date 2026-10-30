// Run with: node --test web/lib/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localDate, addDays, bucketActivities, groupByStage, isRotten, fullName,
  brisbaneToIso, normalisePhone, dayLabel, timeOnly, leadQueues, ago, daysInPhase,
} from './logic.js';

// 21:51 Fri 23 Oct in Brisbane = 11:51 UTC
const NOW = new Date('2026-10-23T11:51:00Z');

test('localDate uses Brisbane, not UTC', () => {
  // 23:30 UTC on the 23rd is already the 24th in Brisbane
  assert.equal(localDate(new Date('2026-10-23T23:30:00Z')), '2026-10-24');
  assert.equal(localDate(NOW), '2026-10-23');
});

test('addDays crosses month ends', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('bucketActivities splits and skips done items', () => {
  const acts = [
    { id: 1, due_date: '2026-10-22', done: false },
    { id: 2, due_date: '2026-10-23', due_at: '2026-10-23T05:00:00Z', done: false },
    { id: 3, due_date: '2026-10-23', due_at: '2026-10-22T23:00:00Z', done: false },
    { id: 4, due_date: '2026-10-24', done: false },
    { id: 5, due_date: '2026-10-23', done: true },
  ];
  const b = bucketActivities(acts, NOW);
  assert.deepEqual(b.overdue.map((a) => a.id), [1]);
  assert.deepEqual(b.today.map((a) => a.id), [3, 2]); // sorted by time
  assert.deepEqual(b.upcoming.map((a) => a.id), [4]);
});

test('groupByStage orders columns and totals values', () => {
  const stages = [{ id: 2, sort_order: 2 }, { id: 1, sort_order: 1 }];
  const cols = groupByStage(
    [{ stage_id: 1, value_aud: '1000' }, { stage_id: 1, value_aud: 500 }, { stage_id: 2, value_aud: null }, { stage_id: 9 }],
    stages,
  );
  assert.deepEqual(cols.map((c) => c.id), [1, 2]);
  assert.equal(cols[0].total, 1500);
  assert.equal(cols[0].deals.length, 2);
  assert.equal(cols[1].total, 0);
});

test('isRotten respects the stage limit', () => {
  const stage = { days_to_rotten: 2 };
  assert.equal(isRotten({ stage_changed_at: '2026-10-20T00:00:00Z' }, stage, NOW), true);
  assert.equal(isRotten({ stage_changed_at: '2026-10-22T12:00:00Z' }, stage, NOW), false);
  assert.equal(isRotten({ stage_changed_at: '2026-01-01T00:00:00Z' }, { days_to_rotten: null }, NOW), false);
});

test('brisbaneToIso converts local appointment times', () => {
  assert.equal(brisbaneToIso('2026-10-24', '10:00'), '2026-10-24T00:00:00.000Z');
  assert.equal(brisbaneToIso('2026-10-24', '08:30'), '2026-10-23T22:30:00.000Z');
  assert.equal(brisbaneToIso('2026-10-24', ''), null);
});

test('timeOnly shows Brisbane time', () => {
  assert.match(timeOnly('2026-10-24T00:00:00Z'), /^10:00\s?am$/i);
  assert.equal(timeOnly(null), 'All day');
});

test('normalisePhone handles +61 and spacing', () => {
  assert.equal(normalisePhone('+61 412 345 678'), '0412345678');
  assert.equal(normalisePhone('0412 345 678'), '0412345678');
});

test('leadQueues orders the call list', () => {
  const leads = [
    { id: 'old-new', status: 'new', attempts: 0, created_at: '2026-10-23T01:00:00Z' },
    { id: 'new-new', status: 'new', attempts: 0, created_at: '2026-10-23T11:00:00Z' },
    { id: 'cb-due', status: 'callback', attempts: 1, next_call_at: '2026-10-23T11:00:00Z' },
    { id: 'cb-later', status: 'callback', attempts: 1, next_call_at: '2026-10-24T00:00:00Z' },
    { id: 'tried-long-ago', status: 'attempting', attempts: 2, last_attempt_at: '2026-10-21T00:00:00Z' },
    { id: 'tried-recently', status: 'attempting', attempts: 1, last_attempt_at: '2026-10-23T10:00:00Z' },
    { id: 'booked', status: 'booked', attempts: 3 },
  ];
  const q = leadQueues(leads, NOW);
  assert.deepEqual(q.due.map((l) => l.id), ['cb-due']);
  assert.deepEqual(q.fresh.map((l) => l.id), ['new-new', 'old-new']);
  assert.deepEqual(q.retry.map((l) => l.id), ['tried-long-ago', 'tried-recently']);
  assert.deepEqual(q.later.map((l) => l.id), ['cb-later']);
});

test('ago and daysInPhase', () => {
  assert.equal(ago('2026-10-23T11:39:00Z', NOW), '12 min ago');
  assert.equal(ago('2026-10-21T11:51:00Z', NOW), '2 days ago');
  assert.equal(daysInPhase({ phase_changed_at: '2026-10-20T11:00:00Z' }, NOW), 3);
});

test('fullName and dayLabel', () => {
  assert.equal(fullName({ first_name: 'Larry', last_name: 'Friedberg' }), 'Larry Friedberg');
  assert.equal(fullName({}), '(no name)');
  assert.equal(dayLabel('2026-10-23', NOW), 'Today');
  assert.equal(dayLabel('2026-10-24', NOW), 'Tomorrow');
});
