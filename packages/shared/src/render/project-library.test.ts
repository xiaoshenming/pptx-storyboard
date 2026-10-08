import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, expect, vi, test } from 'vitest';

import { deleteAutosaveSnapshot, saveAutosaveSnapshot } from './autosave-store';
import {
	createProject,
	deleteProject,
	listProjects,
	migrateProjects,
	readProject,
	saveProject,
} from './project-library';

beforeEach(() => {
	vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test('keeps same-name imports separate and persists their independent bytes', async () => {
	const a = await createProject('课件.pptx', new Uint8Array([1]));
	const b = await createProject('课件.pptx', new Uint8Array([2]));
	expect(a.id).not.toBe(b.id);
	expect(a.autosaveKey).not.toBe(b.autosaveKey);
	expect(a.storyboardKey).not.toBe(b.storyboardKey);
	await expect(listProjects()).resolves.toHaveLength(2);
	expect((await readProject(a.id))?.data).toStrictEqual(new Uint8Array([1]));
});

test('opens newer autosave bytes and lists their modified time', async () => {
	vi.spyOn(Date, 'now').mockReturnValue(1000);
	const a = await createProject('a.pptx', new Uint8Array([1]));
	vi.spyOn(Date, 'now').mockReturnValue(2000);
	await saveAutosaveSnapshot(a.autosaveKey, new Uint8Array([2, 3]));
	expect((await readProject(a.id))?.data).toStrictEqual(new Uint8Array([2, 3]));
	expect((await listProjects())[0].updatedAt).toBe(2000);
	vi.spyOn(Date, 'now').mockReturnValue(3000);
	await saveProject(a, new Uint8Array([4]));
	expect((await readProject(a.id))?.data).toStrictEqual(new Uint8Array([4]));
});

test('migrates session and snapshots once, preferring newer bytes without deleting legacy data', async () => {
	vi.spyOn(Date, 'now').mockReturnValue(2000);
	await saveAutosaveSnapshot('old.pptx', new Uint8Array([2]));
	const session = { fileName: 'old.pptx', data: new Uint8Array([1]), timestamp: 1000 };
	await migrateProjects(session);
	await migrateProjects(session);
	const rows = await listProjects();
	expect(rows).toHaveLength(1);
	expect(rows[0].storyboardKey).toBeUndefined();
	expect((await readProject(rows[0].id))?.data).toStrictEqual(new Uint8Array([2]));
});

test('does not migrate a new project snapshot as another legacy project', async () => {
	const a = await createProject('new.pptx', new Uint8Array([1]));
	await saveAutosaveSnapshot(a.autosaveKey, new Uint8Array([2]));
	await migrateProjects({ fileName: a.autosaveKey, data: new Uint8Array([1]), timestamp: 1 });
	await expect(listProjects()).resolves.toHaveLength(1);
});

test('rejects failed writes instead of reporting an unsaved project as saved', async () => {
	vi.spyOn(indexedDB, 'open').mockImplementation(() => {
		throw new DOMException('full', 'QuotaExceededError');
	});
	await expect(createProject('a.pptx', new Uint8Array([1]))).rejects.toThrow('full');
});

test('refuses an empty serialization without overwriting the saved deck', async () => {
	const a = await createProject('a.pptx', new Uint8Array([1]));
	await expect(saveProject(a, new Uint8Array())).rejects.toThrow();
	expect((await readProject(a.id))?.data).toStrictEqual(new Uint8Array([1]));
});

test('keeps edited project bytes even after its temporary recovery snapshot is cleaned', async () => {
	vi.spyOn(Date, 'now').mockReturnValue(1000);
	const a = await createProject('a.pptx', new Uint8Array([1]));
	vi.spyOn(Date, 'now').mockReturnValue(2000);
	await saveAutosaveSnapshot(a.autosaveKey, new Uint8Array([2]));
	await deleteAutosaveSnapshot(a.autosaveKey);
	expect((await readProject(a.id))?.data).toStrictEqual(new Uint8Array([2]));
});

test('deletes project metadata, bytes, and its recovery snapshot', async () => {
	const project = await createProject('delete-me.pptx', new Uint8Array([1]));
	await saveAutosaveSnapshot(project.autosaveKey, new Uint8Array([2]));
	await deleteProject(project);
	await expect(listProjects()).resolves.toHaveLength(0);
	await expect(readProject(project.id)).resolves.toBeNull();
});
