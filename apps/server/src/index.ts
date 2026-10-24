import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();
app.get('/api/health', (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`gridcast server on :${port}`));
