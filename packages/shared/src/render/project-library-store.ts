export interface LocalProject {
	id: string;
	name: string;
	updatedAt: number;
	size: number;
	autosaveKey: string;
	/** Undefined for migrated projects, preserving their historical storyboard key. */
	storyboardKey?: string;
}
export interface LocalProjectContent extends LocalProject {
	data: Uint8Array;
}
export const PROJECT_KEY_PREFIX = 'pptx-project:';

export function openProjectDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('pptx-local-projects', 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore('projects', { keyPath: 'id' });
			request.result.createObjectStore('data');
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		request.onblocked = () =>
			reject(new Error('本地项目数据库被其他页面占用，请关闭其他页面后重试。'));
	});
}

export async function requestProjectValue<T>(
	store: string,
	read: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	const db = await openProjectDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly');
		const request = read(tx.objectStore(store));
		tx.oncomplete = () => {
			db.close();
			resolve(request.result);
		};
		tx.onabort = () => {
			db.close();
			reject(tx.error ?? request.error);
		};
	});
}

export async function writeProject(project: LocalProject, data: Uint8Array): Promise<void> {
	if (data.byteLength === 0) {
		throw new Error('文件尚未加载完成或无法保存，请等待编辑器就绪后重试。');
	}
	const db = await openProjectDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(['projects', 'data'], 'readwrite');
		tx.objectStore('projects').put(project);
		tx.objectStore('data').put(new Uint8Array(data), project.id);
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onabort = () => {
			db.close();
			reject(tx.error ?? new Error('保存项目失败'));
		};
	});
}

export async function deleteStoredProject(id: string): Promise<void> {
	const db = await openProjectDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(['projects', 'data'], 'readwrite');
		tx.objectStore('projects').delete(id);
		tx.objectStore('data').delete(id);
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onabort = () => {
			db.close();
			reject(tx.error ?? new Error('删除项目失败'));
		};
	});
}

/** Promote autosaves into durable project bytes, atomically against other tabs. */
export async function persistProjectAutosave(
	key: string,
	data: Uint8Array,
	timestamp: number,
): Promise<void> {
	const db = await openProjectDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(['projects', 'data'], 'readwrite');
		const projects = tx.objectStore('projects');
		const request = projects.get(key.startsWith(PROJECT_KEY_PREFIX) ? key : `legacy:${key}`);
		request.onsuccess = () => {
			const project = request.result as LocalProject | undefined;
			if (project && timestamp >= project.updatedAt && data.byteLength > 0) {
				projects.put({ ...project, updatedAt: timestamp, size: data.byteLength });
				tx.objectStore('data').put(new Uint8Array(data), project.id);
			}
		};
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onabort = () => {
			db.close();
			reject(tx.error ?? new Error('项目自动保存失败'));
		};
	});
}
