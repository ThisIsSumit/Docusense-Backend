import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../../config/config';
import { AppError } from '../../shared/types/api.types';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

export interface StoredFile {
  key: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
}

export interface StorageProvider {
  save(file: Express.Multer.File, folder: string, key?: string, overwrite?: boolean): Promise<StoredFile>;
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

  async save(file: Express.Multer.File, folder: string, key?: string, overwrite = false): Promise<StoredFile> {
    const dir = path.join(this.basePath, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const storageKey = key ?? `${folder}/${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    const dest = path.join(this.basePath, storageKey);

    if (file.path) {
      const relativePath = path.relative(this.basePath, file.path);
      if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath) && !key) {
        return {
          key: relativePath.split(path.sep).join('/'),
          url: `/files/${relativePath.split(path.sep).join('/')}`,
          sizeBytes: file.size,
          mimeType: file.mimetype,
        };
      }

      if (overwrite && fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }

      fs.copyFileSync(file.path, dest);
      if (file.path !== dest) {
        fs.unlinkSync(file.path);
      }
    } else if (file.buffer) {
      if (overwrite && fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }

      fs.writeFileSync(dest, file.buffer);
    } else {
      throw new AppError('Uploaded file has no buffer or path', 400, 'INVALID_FILE');
    }

    return {
      key: storageKey,
      url: `/files/${storageKey}`,
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
        realtime: {
              transport: ws as never,
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

  async save(file: Express.Multer.File, folder: string, key?: string, overwrite = false): Promise<StoredFile> {
    const storageKey = key ?? this.buildKey(file, folder);
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

      const { error } = await this.client.storage.from(this.bucket).upload(storageKey, body, {
        contentType: file.mimetype,
        upsert: overwrite,
      });

      if (error) {
        throw new AppError(error.message, 500, 'STORAGE_UPLOAD_FAILED');
      }

      return {
        key: storageKey,
        url: this.getUrl(storageKey),
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
    const { bucket, innerKey } = this.parseKey(key);
    const { error } = await this.client.storage.from(bucket).remove([innerKey]);
    if (error) {
      throw new AppError(error.message, 500, 'STORAGE_DELETE_FAILED');
    }
  }

  getUrl(key: string): string {
    return `supabase://${this.bucket}/${key}`;
  }

  private parseKey(key: string): { bucket: string; innerKey: string } {
    // Accept multiple key formats:
    // - plain key: "users/..."
    // - supabase scheme: "supabase://bucket/path/to/object"
    // - http(s) public URL: "https://.../object/..."
    if (!key) return { bucket: this.bucket, innerKey: key };

    // supabase://bucket/key
    if (key.startsWith('supabase://')) {
      const rest = key.replace('supabase://', '');
      const idx = rest.indexOf('/');
      if (idx === -1) return { bucket: rest, innerKey: '' };
      const bucket = rest.slice(0, idx);
      const innerKey = rest.slice(idx + 1);
      return { bucket, innerKey };
    }

    // Full URL handling: try to extract bucket and key if it matches Supabase storage url patterns
    try {
      const u = new URL(key);
      // Supabase storage public URL shapes often include '/object/public/{bucket}/{path}' or '/storage/v1/object/public/{bucket}/{path}'
      const parts = u.pathname.split('/').filter(Boolean);
      const objIndex = parts.indexOf('object');
      const storageIndex = parts.indexOf('storage');
      if (objIndex !== -1) {
        // e.g. /storage/v1/object/public/{bucket}/{path...}
        const maybeBucket = parts[objIndex + 2] ?? this.bucket;
        const innerKey = parts.slice(objIndex + 3).join('/');
        return { bucket: maybeBucket, innerKey };
      }

      // Fallback: assume last two segments contain bucket and key
      if (parts.length >= 2) {
        const maybeBucket = parts[parts.length - 2];
        const innerKey = parts[parts.length - 1];
        return { bucket: maybeBucket, innerKey };
      }
    } catch (err) {
      // not a URL — fall through
    }

    // Default: use configured bucket and the provided key as innerKey
    return { bucket: this.bucket, innerKey: key };
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    const { bucket, innerKey } = this.parseKey(key);
    const { data, error } = await this.client.storage.from(bucket).download(innerKey);
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
