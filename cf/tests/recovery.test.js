import { describe, it, expect } from 'vitest';
import { classifyHabit, recoveryTimeline, milestoneFor } from '../src/recovery.js';

describe('classifyHabit', () => {
  const cases = [
    ['Quit smoking', 'nicotine'],
    ['Vaping', 'nicotine'],
    ['No more booze', 'alcohol'],
    ['Cutting caffeine', 'caffeine'],
    ['Stop weed', 'cannabis'],
    ['No betting', 'gambling'],
    ['Porn free', 'porn'],
    ['Less Instagram', 'social_media'],
    ['Stop online shopping', 'shopping'],
    ['Stop gaming', 'gaming'],
    ['No sugar', 'sugar'],
    ['Something else', 'general'],
  ];
  it.each(cases)('classifies %s as %s', (name, cat) => {
    expect(classifyHabit(name)).toBe(cat);
  });

  it('falls back to general for empty or unknown names', () => {
    expect(classifyHabit('')).toBe('general');
    expect(classifyHabit()).toBe('general');
  });
});

describe('recoveryTimeline', () => {
  it('returns the general timeline for unknown habits', () => {
    const tl = recoveryTimeline('random habit');
    expect(tl.length).toBeGreaterThan(5);
    expect(tl[0].days).toBe(1);
  });

  it('returns category-specific timelines keyed by classification', () => {
    expect(recoveryTimeline('quit smoking')[0].days).toBeLessThan(1); // 20 min entry
    expect(recoveryTimeline('No more booze')[0].days).toBeGreaterThan(0);
  });

  it('timeline entries are sorted ascending by days', () => {
    for (const tl of ['nicotine', 'alcohol', 'caffeine', 'cannabis', 'gambling', 'porn', 'social_media', 'shopping', 'gaming', 'sugar', 'general']) {
      const t = recoveryTimeline(tl);
      for (let i = 1; i < t.length; i++) expect(t[i].days).toBeGreaterThan(t[i - 1].days);
    }
  });
});

describe('milestoneFor', () => {
  it('returns the current milestone reached and the next one ahead', () => {
    const m = milestoneFor('general', 7);
    expect(m.current).not.toBeNull();
    expect(m.current.days).toBe(7);
    expect(m.next).not.toBeNull();
    expect(m.next.days).toBe(14);
    expect(m.next.daysRemaining).toBe(7);
  });

  it('reports daysRemaining as a rounded-up ceiling', () => {
    const m = milestoneFor('general', 1);
    expect(m.current.label).toBe('Day 1');
    expect(m.next.days).toBe(3);
    expect(m.next.daysRemaining).toBe(2);
  });

  it('has no next milestone beyond the final one', () => {
    const m = milestoneFor('general', 400);
    expect(m.current.days).toBe(365);
    expect(m.next).toBeNull();
  });

  it('returns nulls when no milestone is reached yet', () => {
    const m = milestoneFor('general', 0);
    expect(m.current).toBeNull();
    expect(m.next).not.toBeNull();
  });

  it('coerces numeric strings and handles invalid clean days', () => {
    expect(milestoneFor('general', '7').current.days).toBe(7);
    expect(milestoneFor('general', null).current).toBeNull();
    expect(milestoneFor('general', 'nope').current).toBeNull();
  });

  it('uses category timelines for named habits', () => {
    const m = milestoneFor('quit smoking', 0);
    expect(m.next.days).toBeLessThan(1); // 20-minute milestone
  });
});
