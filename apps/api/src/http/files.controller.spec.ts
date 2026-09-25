import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { paths } from '../config/env';
import { createTestDb } from '../db/test-utils';
import { ChannelsRepository, ProductionsRepository } from '../db/repositories';
import { FilesController } from './files.controller';

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    setHeader: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    status: jest.fn().mockReturnThis(),
    end: jest.fn(),
    write: jest.fn(() => true),
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    removeListener: jest.fn(),
  };
  return res as unknown as Response & { headers: Record<string, string> };
}

function fakeReq(file: string, range?: string): Request {
  return { headers: range ? { range } : {}, params: { path: file }, url: '' } as unknown as Request;
}

describe('FilesController', () => {
  let controller: FilesController;

  beforeAll(() => {
    mkdirSync(paths.previews(), { recursive: true });
  });

  afterAll(() => {
    rmSync(paths.previews(), { recursive: true, force: true });
  });

  beforeEach(() => {
    const { db } = createTestDb();
    controller = new FilesController(new ChannelsRepository(db), new ProductionsRepository(db));
  });

  it('rejects `..` path traversal', async () => {
    await expect(controller.stream('previews', fakeReq('../../etc/passwd'), fakeRes())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects an absolute path with a drive letter', async () => {
    await expect(controller.stream('previews', fakeReq('C:/Windows/win.ini'), fakeRes())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s for an unknown production id', async () => {
    await expect(controller.stream('no-such-production', fakeReq('render.mp4'), fakeRes())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('serves a 206 partial response for a Range request', async () => {
    const content = Buffer.from('0123456789');
    const fileName = 'sample.wav';
    writeFileSync(join(paths.previews(), fileName), content);

    const res = fakeRes();
    await controller.stream('previews', fakeReq(fileName, 'bytes=2-5'), res);

    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.headers['Content-Range']).toBe('bytes 2-5/10');
    expect(res.headers['Content-Length']).toBe('4');
    expect(res.headers['Accept-Ranges']).toBe('bytes');
  });

  it('serves the whole file with 200 when no Range header is given', async () => {
    const fileName = 'full.wav';
    writeFileSync(join(paths.previews(), fileName), Buffer.from('hello world'));

    const res = fakeRes();
    await controller.stream('previews', fakeReq(fileName), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.headers['Content-Length']).toBe('11');
  });
});
