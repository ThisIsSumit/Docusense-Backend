import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../../config/config';
import { AppError } from '../../shared/types/api.types';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface StoredFile {
  key: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
}

export interface StorageProvider {
  save(file: Express.Multer.File, folder: string): Promise<StoredFile>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
  getStream(key: string): fs.ReadStream | Promise<NodeJS.ReadableStream>;
}

// ── Local Storage ─────────────────────────────────────────────────────────────

class LocalStorageProvider implements StorageProvider {
  private readonly basePath: string;

  constructor() {
    this.basePath = path.resolve(config.STORAGE_LOCAL_PATH);
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  async save(file: Express.Multer.File, folder: string): Promise<StoredFile> {
    const dir = path.join(this.basePath, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const key = `${folder}/${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    const dest = path.join(this.basePath, key);

    if (file.path) {
      const relativePath = path.relative(this.basePath, file.path);
      if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        return {
          key: relativePath.split(path.sep).join('/'),
          url: `/files/${relativePath.split(path.sep).join('/')}`,
          sizeBytes: file.size,
          mimeType: file.mimetype,
        };
      }

      fs.copyFileSync(file.path, dest);
      fs.unlinkSync(file.path);
    } else if (file.buffer) {
      fs.writeFileSync(dest, file.buffer);
    } else {
      throw new AppError('Uploaded file has no buffer or path', 400, 'INVALID_FILE');
    }

    return {
      key,
      url: `/files/${key}`,
      sizeBytes: file.size,
      mimeType: file.mimetype,
    };
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.basePath, key);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  getUrl(key: string): string {
    return `/files/${key}`;
  }

  getStream(key: string): fs.ReadStream {
    const filePath = path.join(this.basePath, key);
    if (!fs.existsSync(filePath)) {
      throw new AppError('File not found', 404, 'NOT_FOUND');
    }
    return fs.createReadStream(filePath);
  }
}

// ── Supabase Storage ─────────────────────────────────────────────────────────

class SupabaseStorageProvider implements StorageProvider {
  private readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(
      config.SUPABASE_URL!,
      config.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  private get bucket(): string {
    return config.SUPABASE_STORAGE_BUCKET;
  }

  private buildKey(file: Express.Multer.File, folder: string): string {
    return `${folder}/${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
  }

  async save(file: Express.Multer.File, folder: string): Promise<StoredFile> {
    const key = this.buildKey(file, folder);
    const filePath = file.path ? path.resolve(file.path) : null;

    try {
      let body: Buffer;
      if (filePath) {
        body = fs.readFileSync(filePath);
      } else if (file.buffer) {
        body = Buffer.isBuffer(file.buffer)
          ? file.buffer
          : Buffer.from(file.buffer);
      } else {
        throw new AppError('Uploaded file has no buffer or path', 400, 'INVALID_FILE');
      }

      const { error } = await this.client.storage.from(this.bucket).upload(key, body, {
        contentType: file.mimetype,
        upsert: false,
      });

      if (error) {
        throw new AppError(error.message, 500, 'STORAGE_UPLOAD_FAILED');
      }

      return {
        key,
        url: this.getUrl(key),
        sizeBytes: file.size,
        mimeType: file.mimetype,
      };
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    if (error) {
      throw new AppError(error.message, 500, 'STORAGE_DELETE_FAILED');
    }
  }

  getUrl(key: string): string {
    return `supabase://${this.bucket}/${key}`;
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) {
      throw new AppError('File not found', 404, 'NOT_FOUND');
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    return Readable.from(buffer);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

function createStorageProvider(): StorageProvider {
  if (config.STORAGE_PROVIDER === 'local') {
    return new LocalStorageProvider();
  }

  if (config.STORAGE_PROVIDER === 'supabase') {
    return new SupabaseStorageProvider();
  }

  // s3 is not implemented yet; fall back to local storage until added.
  return new LocalStorageProvider();
}

export const storageService = createStorageProvider();
