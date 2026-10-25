import { describe, expect, it } from 'vitest';
import { parsePlay } from '../src/index.ts';
import { evaluate, loadSeason, rate, SEASONS } from './harness.ts';

const P = (text: string, extra: Partial<Parameters<typeof parsePlay>[0]> = {}) =>
  parsePlay({
    text,
    offense: 'PIT',
    defense: 'TB',
    yardsToEndzone: 70,
    down: 1,
    distance: 10,
    ...extra,
  });

describe('runs', () => {
  it('reads gap, direction, yards, rusher and tacklers (nflverse style)', () => {
    const p = P('(5:48) 1-K.Gainwell right guard to PIT 44 for 14 yards (5-J.Ramsey).');
    expect(p).toMatchObject({
      type: 'run',
      direction: 'right',
      gap: 'guard',
      yards: 14,
      startYd: 30,
      endYd: 44,
    });
    expect(p.players).toEqual([
      { role: 'rusher', name: 'K.Gainwell', team: 'PIT', jersey: 1 },
      { role: 'tackler', name: 'J.Ramsey', team: 'TB', jersey: 5 },
    ]);
    expect(p.firstDown).toBe(true);
  });

  it('reads ESPN style text without jersey numbers', () => {
    const p = P('(Shotgun) J.Warren up the middle to PIT 33 for 3 yds (V.Vea; L.David).');
    expect(p).toMatchObject({
      type: 'run',
      direction: 'middle',
      gap: 'middle',
      yards: 3,
      formation: 'shotgun',
    });
    expect(p.players.map((x) => x.name)).toEqual(['J.Warren', 'V.Vea', 'L.David']);
  });

  it('handles no gain, losses and touchdowns', () => {
    expect(P('13-R.Dowdle left end to PIT 30 for no gain (34-A.Anzalone).').yards).toBe(0);
    expect(P('13-R.Dowdle left tackle to PIT 27 for -3 yards.').yards).toBe(-3);
    const td = P('13-R.Dowdle right end for 4 yards, TOUCHDOWN.', { yardsToEndzone: 4 });
    expect(td).toMatchObject({ result: 'td', points: 6, endYd: 100 });
  });

  it('marks scrambles as runs', () => {
    const p = P(
      '(Shotgun) 8-A.Rodgers scrambles left end pushed ob at PIT 39 for 9 yards (6-P.Queen).',
    );
    expect(p).toMatchObject({ type: 'run', scramble: true, direction: 'left', yards: 9 });
  });
});

describe('passes', () => {
  it('complete with depth and side', () => {
    const p = P(
      '(Shotgun) 8-A.Rodgers pass short right to 17-G.Bernard to PIT 41 for 11 yards (22-A.Samuel).',
    );
    expect(p).toMatchObject({
      type: 'pass',
      result: 'complete',
      depth: 'short',
      direction: 'right',
      yards: 11,
    });
    expect(p.players.slice(0, 2)).toEqual([
      { role: 'passer', name: 'A.Rodgers', team: 'PIT', jersey: 8 },
      { role: 'receiver', name: 'G.Bernard', team: 'PIT', jersey: 17 },
    ]);
  });

  it('incomplete', () => {
    const p = P(
      '(11:06) (Shotgun) 8-A.Rodgers pass incomplete deep left to 4-D.Metcalf (25-J.Parrish).',
    );
    expect(p).toMatchObject({
      type: 'pass',
      result: 'incomplete',
      depth: 'deep',
      direction: 'left',
      yards: 0,
      endYd: 30,
    });
  });

  it('interception flips possession and spots the return', () => {
    const p = P(
      '(Shotgun) 8-A.Rodgers pass deep middle intended for 4-D.Metcalf INTERCEPTED by 24-Z.McCollum at TB 10. 24-Z.McCollum to TB 35 for 25 yards (4-D.Metcalf).',
    );
    expect(p).toMatchObject({
      type: 'pass',
      result: 'interception',
      possessionChange: true,
      endYd: 65,
    });
    expect(p.players.find((x) => x.role === 'returner')).toMatchObject({
      name: 'Z.McCollum',
      team: 'TB',
    });
  });

  it('passing touchdown, ESPN style with the kick appended', () => {
    const p = P(
      '(Shotgun) A.Rodgers pass short right to G.Bernard for 6 yds, TOUCHDOWN (C.Boswell Kick).',
      {
        yardsToEndzone: 6,
      },
    );
    expect(p).toMatchObject({ type: 'pass', result: 'td', yards: 6, points: 6 });
    expect(p.players.some((x) => x.role === 'tackler')).toBe(false);
  });

  it('sack', () => {
    const p = P('(Shotgun) 8-A.Rodgers sacked at PIT 23 for -7 yards (99-C.Kancey).');
    expect(p).toMatchObject({ type: 'sack', yards: -7, endYd: 23 });
    expect(p.players[1]).toMatchObject({ role: 'tackler', name: 'C.Kancey', team: 'TB' });
  });

  it('lost fumble', () => {
    const p = P(
      '13-R.Dowdle up the middle to PIT 34 for 4 yards (5-I.Melifonwu). FUMBLES (5-I.Melifonwu), RECOVERED by TB-34-A.Anzalone at PIT 35.',
    );
    expect(p).toMatchObject({ type: 'run', result: 'fumble' });
  });
});

describe('kicks', () => {
  it('punt with return', () => {
    const p = parsePlay({
      text: '(2:23) 9-R.Dixon punts 38 yards to PIT 32, Center-86-E.Deckers. 10-K.Wetjen to PIT 40 for 8 yards (37-R.Nowakowski).',
      offense: 'TB',
      defense: 'PIT',
      yardsToEndzone: 70,
    });
    expect(p).toMatchObject({
      type: 'punt',
      formation: 'punt',
      kickYards: 38,
      returnYards: 8,
      possessionChange: true,
      endYd: 60,
    });
  });

  it('kickoff touchback with the receiving team as offense (nflverse)', () => {
    const p = parsePlay({
      text: '9-C.Boswell kicks 65 yards from PIT 35 to end zone, Touchback to the TB 35.',
      offense: 'TB',
      defense: 'PIT',
      yardsToEndzone: 35,
    });
    expect(p).toMatchObject({ type: 'kickoff', result: 'touchback', startYd: 65, endYd: 35 });
    expect(p.possessionChange).toBeUndefined();
    expect(p.players[0]).toMatchObject({ role: 'kicker', team: 'PIT' });
  });

  it('field goal and extra point', () => {
    expect(
      P('9-C.Boswell 58 yard field goal is GOOD, Center-46-C.Kuntz, Holder-19-C.Johnston.'),
    ).toMatchObject({
      type: 'fg',
      result: 'good',
      kickYards: 58,
      points: 3,
    });
    expect(P('9-C.Boswell 45 yard field goal is No Good, Wide Right.')).toMatchObject({
      result: 'no_good',
      possessionChange: true,
    });
    expect(P('9-C.Boswell extra point is GOOD, Center-46-C.Kuntz.')).toMatchObject({
      type: 'pat',
      result: 'good',
      points: 1,
    });
  });
});

describe('penalties', () => {
  it('no play, against the offense', () => {
    const p = P(
      '(1:52) (Shotgun) PENALTY on PIT-67-L.Goedeke, False Start, 5 yards, enforced at PIT 30 - No Play.',
    );
    expect(p.type).toBe('penalty');
    expect(p.penalty).toMatchObject({
      name: 'False Start',
      team: 'PIT',
      yards: 5,
      accepted: true,
      noPlay: true,
    });
    expect(p.endYd).toBe(25);
  });

  it('defensive pass interference moves the ball forward', () => {
    const p = P(
      '(Shotgun) 8-A.Rodgers pass incomplete deep left to 4-D.Metcalf. PENALTY on TB-25-J.Parrish, Defensive Pass Interference, 12 yards, enforced at PIT 30 - No Play.',
    );
    expect(p).toMatchObject({ type: 'penalty', endYd: 42 });
  });

  it('declined penalty keeps the play', () => {
    const p = P(
      '13-R.Dowdle left end to PIT 35 for 5 yards (34-A.Anzalone). Penalty on TB, Defensive Offside, declined.',
    );
    expect(p).toMatchObject({ type: 'run', yards: 5 });
    expect(p.penalty).toMatchObject({ accepted: false, noPlay: false });
  });

  it('offsetting', () => {
    const p = P(
      '8-A.Rodgers pass incomplete. Penalty on PIT-79-R.Stanley, Illegal Formation, offsetting, enforced at PIT 30 - No Play. Penalty on TB-35-J.Watson, Defensive Pass Interference, offsetting.',
    );
    expect(p.type).toBe('penalty');
    expect(p.penalty).toMatchObject({ offsetting: true, accepted: false });
    expect(p.endYd).toBe(30);
  });
});

describe('other cases', () => {
  it('uses the play after a reversed review', () => {
    const p = P(
      '(Shotgun) 8-A.Rodgers pass short left to 4-D.Metcalf to PIT 45 for 15 yards. The Replay Official reviewed the pass completion ruling, and the play was REVERSED. (Shotgun) 8-A.Rodgers pass incomplete short left to 4-D.Metcalf.',
    );
    expect(p).toMatchObject({ result: 'incomplete', review: true, yards: 0 });
  });

  it('two-point conversion', () => {
    const p = P(
      'TWO-POINT CONVERSION ATTEMPT. 8-A.Rodgers pass to 4-D.Metcalf is complete. ATTEMPT SUCCEEDS.',
      {
        yardsToEndzone: 2,
      },
    );
    expect(p).toMatchObject({ type: 'pass', twoPoint: true, result: 'good', points: 2 });
  });

  it('kneel and spike', () => {
    expect(P('8-A.Rodgers kneels to PIT 29 for -1 yards.')).toMatchObject({
      type: 'kneel',
      formation: 'victory',
      yards: -1,
    });
    expect(P('(Shotgun) 8-A.Rodgers spiked the ball to stop the clock.')).toMatchObject({
      type: 'spike',
    });
  });

  it('timeouts and period ends are not plays', () => {
    expect(P('Timeout #2 by TB at 00:15.').type).toBe('other');
    expect(P('END QUARTER 1').type).toBe('other');
  });

  it('collects injuries', () => {
    const p = P(
      '13-R.Dowdle up the middle to PIT 34 for 4 yards (5-I.Melifonwu). 13-R.Dowdle was injured during the play.',
    );
    expect(p.injured).toEqual(['R.Dowdle']);
  });

  it('never throws on junk and reports low confidence', () => {
    const p = parsePlay({ text: '???' });
    expect(p.type).toBe('other');
    expect(p.confidence).toBeLessThan(0.6);
  });
});

describe('accuracy vs nflverse labels (PRD target 95%+)', () => {
  const results = SEASONS.map((s) => [s, evaluate(loadSeason(s))] as const);
  for (const [season, r] of results) {
    it(`${season}: play type, yards and direction >= 95%`, () => {
      expect(r.plays).toBeGreaterThan(10000);
      expect(rate(r.type)).toBeGreaterThanOrEqual(0.95);
      expect(rate(r.yards)).toBeGreaterThanOrEqual(0.95);
      expect(rate(r.direction)).toBeGreaterThanOrEqual(0.95);
    });
  }
});

describe('ESPN touchdowns with the try in the same text', () => {
  const ESPN_TDS = [
    [
      '(Shotgun) J.Daniels pass short left to E.Egbuka for 2 yards, TOUCHDOWN. C.McLaughlin extra point is GOOD, Center-E.Deckers, Holder-R.Dixon.',
      'J.Daniels',
      'E.Egbuka',
      2,
    ],
    [
      '(Shotgun) A.Rodgers pass short left to D.Washington for 5 yards, TOUCHDOWN. C.Boswell extra point is GOOD, Center-C.Kuntz, Holder-C.Johnston.',
      'A.Rodgers',
      'D.Washington',
      5,
    ],
    [
      '(Shotgun) A.Rodgers pass short right to G.Bernard for 6 yards, TOUCHDOWN. C.Boswell extra point is GOOD, Center-C.Kuntz, Holder-C.Johnston.',
      'A.Rodgers',
      'G.Bernard',
      6,
    ],
  ] as const;

  it.each(ESPN_TDS)('parses the pass, not the kick: %s', (text, passer, receiver, yards) => {
    const p = P(text, { yardsToEndzone: yards, distance: yards });
    expect(p).toMatchObject({ type: 'pass', result: 'td', yards, points: 7, endYd: 100 });
    expect(p.players.find((x) => x.role === 'passer')?.name).toBe(passer);
    expect(p.players.find((x) => x.role === 'receiver')?.name).toBe(receiver);
    expect(p.players.find((x) => x.role === 'kicker')).toMatchObject({ team: 'PIT' });
  });

  it('a missed extra point leaves 6', () => {
    const p = P(
      'J.Warren right end for 12 yards, TOUCHDOWN. C.Boswell extra point is No Good, Wide Right, Center-C.Kuntz, Holder-C.Johnston.',
      { yardsToEndzone: 12 },
    );
    expect(p).toMatchObject({ type: 'run', result: 'td', yards: 12, points: 6 });
    expect(p.players.find((x) => x.role === 'rusher')?.name).toBe('J.Warren');
  });

  it('a two-point try that succeeds adds 2, one that fails adds 0', () => {
    const base =
      '(Shotgun) A.Rodgers pass short middle to D.Metcalf for 9 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. ';
    const good = P(`${base}J.Warren rushes up the middle. ATTEMPT SUCCEEDS.`, {
      yardsToEndzone: 9,
    });
    expect(good).toMatchObject({ type: 'pass', result: 'td', yards: 9, points: 8 });
    expect(good.twoPoint).toBeUndefined();
    const bad = P(`${base}A.Rodgers pass to P.Freiermuth is incomplete. ATTEMPT FAILS.`, {
      yardsToEndzone: 9,
    });
    expect(bad).toMatchObject({ type: 'pass', result: 'td', points: 6 });
  });

  it('a pick-six scores for the defense', () => {
    const p = parsePlay({
      text: '(Shotgun) B.Mayfield pass short left intended for M.Evans INTERCEPTED by J.Porter at TB 30. J.Porter for 30 yards, TOUCHDOWN. C.Boswell extra point is GOOD, Center-C.Kuntz, Holder-C.Johnston.',
      offense: 'TB',
      defense: 'PIT',
      yardsToEndzone: 70,
      down: 1,
      distance: 10,
    });
    expect(p).toMatchObject({ type: 'pass', result: 'interception', points: 7 });
    expect(p.players.find((x) => x.role === 'kicker')).toMatchObject({ team: 'PIT' });
  });

  it('a fumble returned for a touchdown scores for the defense', () => {
    const p = parsePlay({
      text: 'B.Irving left tackle to TB 30 for 3 yards (T.Watt). FUMBLES (T.Watt), RECOVERED by PIT-P.Queen at TB 30. P.Queen for 30 yards, TOUCHDOWN. C.Boswell extra point is GOOD, Center-C.Kuntz, Holder-C.Johnston.',
      offense: 'TB',
      defense: 'PIT',
      yardsToEndzone: 73,
      down: 1,
      distance: 10,
    });
    expect(p).toMatchObject({ type: 'run', result: 'fumble', points: 7 });
  });

  it('a standalone extra point (nflverse style) is still a PAT', () => {
    const p = P('C.Boswell extra point is GOOD, Center-C.Kuntz, Holder-C.Johnston.', {
      yardsToEndzone: 15,
    });
    expect(p).toMatchObject({ type: 'pat', result: 'good', points: 1 });
  });
});
