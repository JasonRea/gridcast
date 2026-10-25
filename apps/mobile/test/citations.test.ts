import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EspnSummarySchema, type LoggedEvent, type PlayEvent } from '@gridcast/types';
import { normalizeSummary } from '../../server/src/pipeline/normalize';
import { playLabel } from '@web/lib/plays';
import {
  findInLog,
  findPresented,
  firstCitation,
  speakableAnswer,
  splitCitations,
} from '../src/lib/citations';
import { outcomeOf, HAPTIC_FOR } from '../src/lib/outcome';

const summary = EspnSummarySchema.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '../../../data/fixtures/espn/summary_401873002.json'),
      'utf8',
    ),
  ),
);
const events = normalizeSummary(summary)!.events;
const log: LoggedEvent[] = events.map((event, seq) => ({ seq, event }));
const plays = events.filter((e): e is PlayEvent => e.kind === 'play');

describe('citations', () => {
  it('splits an answer into text and [Q3 4:12] chips', () => {
    expect(splitCitations('The pick [Q3 4:12] and the TD [OT 3:15].')).toEqual([
      { kind: 'text', text: 'The pick ' },
      { kind: 'cite', label: 'Q3 4:12' },
      { kind: 'text', text: ' and the TD ' },
      { kind: 'cite', label: 'OT 3:15' },
      { kind: 'text', text: '.' },
    ]);
    expect(splitCitations('No citations here')).toEqual([
      { kind: 'text', text: 'No citations here' },
    ]);
  });

  it('finds the first citation and reads it aloud naturally', () => {
    expect(firstCitation('See [Q4 1:55] then [Q4 1:21]')).toBe('Q4 1:55');
    expect(speakableAnswer('Field goal [Q4 1:55].')).toBe(
      'Field goal at 1:55 of the fourth quarter.',
    );
  });

  it('looks a citation up in the presented plays and in the full log', () => {
    const target = plays[120]!;
    const label = playLabel(target);
    const i = findPresented(plays, plays.length, label);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(playLabel(plays[i]!)).toBe(label);
    // Not presented yet: only the log lookup finds it.
    expect(findPresented(plays, 10, label)).toBe(-1);
    const seq = findInLog(log, label)!;
    expect(log[seq]!.event.kind).toBe('play');
    expect(findInLog(log, 'Q2 99:99')).toBeUndefined();
  });
});

describe('haptics mapping', () => {
  it('maps touchdowns, turnovers, scores and first downs to iOS haptics', () => {
    const td = plays.find((p) => p.parsed.result === 'td')!;
    const fd = plays.find(
      (p) => p.parsed.firstDown && p.parsed.type === 'run' && p.parsed.result !== 'td',
    )!;
    const fg = plays.find((p) => p.parsed.type === 'fg' && p.parsed.result === 'good')!;
    expect(HAPTIC_FOR[outcomeOf(td)]).toBe('success');
    expect(HAPTIC_FOR[outcomeOf(fd)]).toBe('light');
    expect(HAPTIC_FOR[outcomeOf(fg)]).toBe('medium');
    const turnover = plays.find(
      (p) => p.parsed.result === 'interception' || p.parsed.result === 'fumble',
    );
    if (turnover) expect(HAPTIC_FOR[outcomeOf(turnover)]).toBe('heavy');
  });
});
