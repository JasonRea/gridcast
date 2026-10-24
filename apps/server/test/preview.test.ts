import { describe, expect, it } from 'vitest';
import { GameDetailSchema, type EspnSummary } from '@gridcast/types';
import { extractPreview, templateStorylines } from '../src/games/preview.ts';
import { FEATURED, testServer } from './helpers.ts';

describe('preview', () => {
  it('reads injuries, leaders and the predictor when ESPN sends them, and skips bad sections', async () => {
    const { registry } = testServer();
    const s = (await registry.get(FEATURED))!;
    const summary = {
      ...s.summary,
      injuries: [
        {
          team: { abbreviation: 'PIT' },
          injuries: [
            {
              status: 'Out',
              athlete: { displayName: 'T.J. Watt', position: { abbreviation: 'LB' } },
            },
          ],
        },
        { nonsense: true },
      ],
      leaders: [
        {
          team: { abbreviation: 'NO' },
          leaders: [
            {
              displayName: 'Passing Yards',
              leaders: [{ displayValue: '1,402 YDS', athlete: { displayName: 'Tyler Shough' } }],
            },
          ],
        },
      ],
      predictor: { homeTeam: { gameProjection: '41.3' } },
    } as EspnSummary;
    const p = extractPreview(summary, s.card);
    expect(p.injuries).toEqual([
      { team: 'PIT', players: [{ name: 'T.J. Watt', position: 'LB', status: 'Out' }] },
    ]);
    expect(p.leaders[0]).toMatchObject({ team: 'NO', name: 'Tyler Shough', value: '1,402 YDS' });
    expect(p.predictorHome).toBeCloseTo(0.413);
    const lines = templateStorylines(s.card, p, 0.4);
    expect(lines.join(' ')).toMatch(/PIT -3/);
    expect(lines.join(' ')).toMatch(/Steelers a 60% chance/);
  });

  it('GET /api/games/:id includes preview data for upcoming games', async () => {
    const { app } = testServer();
    const d = GameDetailSchema.parse(await (await app.request(`/api/games/${FEATURED}`)).json());
    expect(d.status).toBe('pre');
    expect(d.preview?.storylines.length).toBeGreaterThan(0);
  });
});
