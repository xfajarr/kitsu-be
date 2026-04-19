import type { IncomingMessage, ServerResponse } from 'node:http';
import app from '../src/app';

export const config = {
  runtime: 'nodejs',
};

function getRequestUrl(req: IncomingMessage) {
  const host = req.headers.host || 'localhost';
  const protocol = (req.headers['x-forwarded-proto'] as string | undefined) || 'https';
  return `${protocol}://${host}${req.url || '/'}`;
}

function readRequestBody(req: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function toWebRequest(req: IncomingMessage) {
  const method = req.method || 'GET';
  const url = getRequestUrl(req);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }

    if (value !== undefined) {
      headers.set(key, value);
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }

  const body = await readRequestBody(req);
  return new Request(url, {
    method,
    headers,
    body: body.length > 0 ? body : undefined,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

async function sendWebResponse(response: Response, res: ServerResponse) {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const request = await toWebRequest(req);
    const response = await app.fetch(request);
    await sendWebResponse(response, res);
  } catch (error) {
    console.error('Vercel handler error', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      success: false,
      error: {
        code: 'FUNCTION_INVOCATION_FAILED',
        message: 'Unexpected server error',
      },
    }));
  }
}
