import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import { todayDate } from '@/shared/date';
import { horizonBucket, horizonWithin, isoWeekOf, normalizeHorizon } from './horizon';
import { createTask, updateTask } from './mutate';
import { findTaskById } from './scan';

describe('isoWeekOf', () => {
  test('weeks belong to the ISO year of their Thursday', () => {
    expect(isoWeekOf('2026-09-28')).toBe('2026-W40');
    expect(isoWeekOf('2026-12-31')).toBe('2026-W53');
    expect(isoWeekOf('2027-01-03')).toBe('2026-W53');
    expect(isoWeekOf('2027-01-04')).toBe('2027-W01');
    expect(isoWeekOf('2024-12-30')).toBe('2025-W01');
  });
});

describe('normalizeHorizon', () => {
  const today = '2026-09-28';

  test('shorthands resolve to the period they name', () => {
    expect(normalizeHorizon('today', today)).toBe('2026-09-28');
    expect(normalizeHorizon('week', today)).toBe('2026-W40');
    expect(normalizeHorizon('next-week', today)).toBe('2026-W41');
    expect(normalizeHorizon('next-week', '2026-12-28')).toBe('2027-W01');
    expect(normalizeHorizon('month', today)).toBe('2026-09');
    expect(normalizeHorizon('later', today)).toBe('later');
    expect(normalizeHorizon('', today)).toBe('');
  });

  test('literal periods pass through, impossible ones are refused', () => {
    expect(normalizeHorizon('2026-W53', today)).toBe('2026-W53');
    expect(() => normalizeHorizon('2025-W53', today)).toThrow('Invalid horizon');
    expect(() => normalizeHorizon('2026-02-30', today)).toThrow('Invalid horizon');
    expect(() => normalizeHorizon('2026-13', today)).toThrow('Invalid horizon');
    expect(() => normalizeHorizon('soon', today)).toThrow('Invalid horizon');
  });
});

describe('horizonBucket', () => {
  const monday = '2026-09-28';

  test('current periods land in their own lane', () => {
    expect(horizonBucket('2026-09-28', monday)).toBe('today');
    expect(horizonBucket('2026-W40', monday)).toBe('week');
    expect(horizonBucket('2026-09', monday)).toBe('month');
    expect(horizonBucket('later', monday)).toBe('later');
  });

  test('a period that has ended is carried over, even one ending yesterday', () => {
    expect(horizonBucket('2026-09-27', monday)).toBe('carried');
    expect(horizonBucket('2026-W39', monday)).toBe('carried');
    expect(horizonBucket('2026-08', monday)).toBe('carried');
  });

  test('a future day lands in the smallest current lane that holds it; a future week or month is later', () => {
    expect(horizonBucket('2026-10-04', monday)).toBe('week');
    expect(horizonBucket('2026-10-05', monday)).toBe('later');
    expect(horizonBucket('2026-W41', monday)).toBe('later');
    expect(horizonBucket('2026-10-15', '2026-10-01')).toBe('month');
    expect(horizonBucket('2026-10', '2026-09-30')).toBe('later');
  });

  test('unset or malformed horizons have no lane', () => {
    expect(horizonBucket('', monday)).toBeNull();
    expect(horizonBucket('next week', monday)).toBeNull();
  });
});

describe('horizonWithin', () => {
  const wednesday = '2026-09-30';

  test('the week holds its own days and itself, not the month', () => {
    expect(horizonWithin('2026-09-28', 'week', wednesday)).toBe(true);
    expect(horizonWithin('2026-10-04', 'week', wednesday)).toBe(true);
    expect(horizonWithin('2026-W40', 'week', wednesday)).toBe(true);
    expect(horizonWithin('2026-09-27', 'week', wednesday)).toBe(false);
    expect(horizonWithin('2026-10', 'week', '2026-10-01')).toBe(false);
  });

  test('the month holds its days, the weeks starting in it, and itself', () => {
    expect(horizonWithin('2026-09-01', 'month', wednesday)).toBe(true);
    expect(horizonWithin('2026-W40', 'month', wednesday)).toBe(true);
    expect(horizonWithin('2026-09', 'month', wednesday)).toBe(true);
    expect(horizonWithin('2026-10-01', 'month', wednesday)).toBe(false);
    expect(horizonWithin('later', 'month', wednesday)).toBe(false);
    expect(horizonWithin('', 'month', wednesday)).toBe(false);
  });
});

describe('horizon on disk', () => {
  test('create and update store the resolved period and it survives a re-read', () => {
    mkdirSync(join(FOLDERS.PROJECTS, 'acme', 'tasks'), { recursive: true });
    const created = createTask({
      project: 'acme',
      title: 'Ship the invoice export',
      description: 'Customers asked for CSV.',
      assignee: ['user'],
      horizon: 'week'
    });
    const id = created.frontmatter.id;
    expect(findTaskById(id)?.frontmatter.horizon).toBe(isoWeekOf(todayDate()));

    updateTask(id, { horizon: 'today' });
    expect(findTaskById(id)?.frontmatter.horizon).toBe(todayDate());
    expect(readFileSync(created.filePath, 'utf-8')).toContain(`horizon: ${todayDate()}\n`);

    updateTask(id, { horizon: '' });
    expect(findTaskById(id)?.frontmatter.horizon).toBe('');
    expect(() => updateTask(id, { horizon: 'someday' })).toThrow('Invalid horizon');
  });
});
