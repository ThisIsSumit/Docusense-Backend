import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/config';
import { AppError } from '../../shared/types/api.types';

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

// ── Factory ───────────────────────────────────────────────────────────────────

function createStorageProvider(): StorageProvider {
  if (config.STORAGE_PROVIDER === 'local') {
    return new LocalStorageProvider();
  }

  // s3 and supabase implementations would go here
  return new LocalStorageProvider();
}

export const storageService = createStorageProvider();
