/**
 * Integration tests for the classify endpoint.
 *
 * Uses `supertest` to drive the Express app without binding a real TCP socket.
 */
import request from 'supertest';
import { createApp } from '../src/app';

// The CSRF middleware requires the custom header on all /v1 routes.
const CSRF_HEADER = 'X-RealityCheck-Request';
const CSRF_VALUE = '1';

function post(app: ReturnType<typeof createApp>, body: Record<string, unknown>) {
  return request(app)
    .post('/v1/classify')
    .set(CSRF_HEADER, CSRF_VALUE)
    .set('Content-Type', 'application/json')
    .send(body);
}

describe('POST /v1/classify', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    // No CLASSIFY_API_KEY set → auth middleware is a no-op.
    delete process.env.CLASSIFY_API_KEY;
    app = createApp();
  });

  test('returns 403 when X-RealityCheck-Request header is missing', async () => {
    const res = await request(app)
      .post('/v1/classify')
      .set('Content-Type', 'application/json')
      .send({ contentType: 'image' });
    expect(res.status).toBe(403);
  });

  test('returns 400 for missing contentType', async () => {
    const res = await post(app, {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contentType/i);
  });

  test('returns 400 for invalid contentType', async () => {
    const res = await post(app, { contentType: 'audio_invalid' });
    expect(res.status).toBe(400);
  });

  test('returns 200 with score and label for image contentType', async () => {
    const res = await post(app, { contentType: 'image' });
    expect(res.status).toBe(200);
    expect(typeof res.body.score).toBe('number');
    expect(['ai', 'human', 'uncertain']).toContain(res.body.label);
  });

  test('returns 200 with score and label for text contentType (neutral)', async () => {
    const res = await post(app, { contentType: 'text', text: 'Hello world' });
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(0.5);
    expect(res.body.label).toBe('uncertain');
  });

  test('returns higher score for a known AI CDN URL', async () => {
    const res = await post(app, {
      contentType: 'image',
      imageUrl: 'https://images.openai.com/dalle3/some-image.jpg',
    });
    expect(res.status).toBe(200);
    expect(res.body.score).toBeGreaterThan(0.5);
    expect(res.body.label).toBe('ai');
  });

  test('returns 400 when imageDataUrl is not a data: URI', async () => {
    const res = await post(app, {
      contentType: 'image',
      imageDataUrl: 'http://example.com/image.jpg',
    });
    expect(res.status).toBe(400);
  });

  test('returns 400 when imageHash is too long', async () => {
    const res = await post(app, {
      contentType: 'image',
      imageHash: 'a'.repeat(200),
    });
    expect(res.status).toBe(400);
  });

  test('returns 401 when CLASSIFY_API_KEY is set but no auth header', async () => {
    process.env.CLASSIFY_API_KEY = 'test-key';
    app = createApp();
    const res = await post(app, { contentType: 'image' });
    expect(res.status).toBe(401);
    delete process.env.CLASSIFY_API_KEY;
  });

  test('returns 200 when correct bearer token is provided', async () => {
    process.env.CLASSIFY_API_KEY = 'test-key';
    app = createApp();
    const res = await request(app)
      .post('/v1/classify')
      .set(CSRF_HEADER, CSRF_VALUE)
      .set('Authorization', 'Bearer test-key')
      .set('Content-Type', 'application/json')
      .send({ contentType: 'image' });
    expect(res.status).toBe(200);
    delete process.env.CLASSIFY_API_KEY;
  });
});

describe('GET /health', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    delete process.env.CLASSIFY_API_KEY;
    app = createApp();
  });

  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('/health does not require the CSRF header', async () => {
    process.env.CLASSIFY_API_KEY = 'test-key';
    app = createApp();
    // /health is outside /v1 → no csrfMiddleware, but authMiddleware still applies.
    // Since the auth key IS set, we must send it.
    const res = await request(app)
      .get('/health')
      .set('Authorization', 'Bearer test-key');
    expect(res.status).toBe(200);
    delete process.env.CLASSIFY_API_KEY;
  });
});

describe('Unknown routes', () => {
  test('returns 404', async () => {
    const app = createApp();
    const res = await request(app).get('/unknown');
    expect(res.status).toBe(404);
  });
});
