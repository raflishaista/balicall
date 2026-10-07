import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitParticipantGrid, participantPage, orderParticipants } from '../src/meetingLayout.ts';

test('desktop uses one, two, then at most three columns and fits 16:9 tiles in available space', () => {
  for (const [count, columns] of [[1, 1], [2, 2], [3, 2], [4, 2], [5, 3], [6, 3], [8, 3], [9, 3]]) {
    for (const [width, height] of [[1400, 780], [980, 500], [780, 250]]) {
      const result = fitParticipantGrid(count, width, height);
      assert.equal(result.columns, columns);
      assert.ok(result.tileWidth * columns + 12 * (columns - 1) <= width + .01);
      assert.ok(result.tileWidth * 9 / 16 * result.rows + 12 * (result.rows - 1) <= height + .01);
    }
  }
});

test('narrow containers adapt columns regardless of viewport width', () => {
  assert.equal(fitParticipantGrid(8, 600, 500).columns, 2);
  assert.equal(fitParticipantGrid(8, 366, 500).columns, 2);
  assert.equal(fitParticipantGrid(8, 300, 500).columns, 1);
});

test('pagination caps nine participants and clamps when participants leave', () => {
  const participants = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual(participantPage(participants, 0).items, participants.slice(0, 9));
  assert.deepEqual(participantPage(participants, 1).items, participants.slice(9, 18));
  assert.equal(participantPage(participants.slice(0, 3), 2).page, 0);
  assert.deepEqual(participantPage([], 0), { page: 0, pages: 1, items: [] });
});

test('arrival and identity determine order, independent of incoming loudness sorting', () => {
  const items = [{ identity: 'C', joinedAt: new Date(3) }, { identity: 'B', joinedAt: new Date(2) }, { identity: 'A', joinedAt: new Date(1) }];
  const expected = ['A', 'B', 'C'];
  assert.deepEqual(orderParticipants(items).map(p => p.identity), expected);
  assert.deepEqual(orderParticipants(items.toReversed()).map(p => p.identity), expected);
  assert.deepEqual(items.map(p => p.identity), ['C', 'B', 'A']);
});
