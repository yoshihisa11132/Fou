import * as fs from 'node:fs';
import { DriveFiles } from '@/models/index.js';
import { DriveFile } from '@/models/entities/drive-file.js';
import { InternalStorage } from './internal-storage.js';
import { downloadUrl } from '@/misc/download-url.js';

export async function copyFileTo(file: DriveFile, toPath: string): Promise<void> {
	if (file.storedInternal) {
		const fromPath = InternalStorage.resolvePath(file.accessKey);
		fs.copyFileSync(fromPath, toPath);
	} else {
		await downloadUrl(file.url, toPath);
	}
}
