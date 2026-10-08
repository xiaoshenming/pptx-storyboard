import {
	deleteAutosaveSnapshot,
	getAutosaveSnapshot,
	listAutosaveSnapshots,
} from './autosave-store';
import {
	deleteStoredProject,
	PROJECT_KEY_PREFIX as PREFIX,
	requestProjectValue as requestValue,
	writeProject,
	persistProjectAutosave,
} from './project-library-store';
import type { LocalProject, LocalProjectContent } from './project-library-store';
import { secureRandomToken } from './secure-random';
import type { SessionDeck } from './session-restore';
import { forgetSessionDeck, loadSessionDeck } from './session-restore';

export type { LocalProject, LocalProjectContent } from './project-library-store';

export async function createProject(name: string, data: Uint8Array): Promise<LocalProject> {
	const id = PREFIX + secureRandomToken(16);
	const project = {
		id,
		name,
		updatedAt: Date.now(),
		size: data.byteLength,
		autosaveKey: id,
		storyboardKey: id,
	};
	await writeProject(project, data);
	return project;
}

export async function saveProject(project: LocalProject, data: Uint8Array): Promise<LocalProject> {
	const updated = { ...project, updatedAt: Date.now(), size: data.byteLength };
	await writeProject(updated, data);
	return updated;
}

export async function deleteProject(project: LocalProject): Promise<void> {
	await deleteStoredProject(project.id);
	await deleteAutosaveSnapshot(project.autosaveKey);
	const session = await loadSessionDeck();
	if (session?.fileName === project.autosaveKey) {
		await forgetSessionDeck();
	}
}

export async function listProjects(): Promise<LocalProject[]> {
	const rows = await requestValue<LocalProject[]>('projects', (store) => store.getAll());
	const snapshots = new Map(
		(await listAutosaveSnapshots()).map((snapshot) => [snapshot.key, snapshot]),
	);
	// Preserve pre-library recovery records before a viewer can expire them.
	for (const row of rows) {
		const info = snapshots.get(row.autosaveKey);
		if (info && info.timestamp > row.updatedAt) {
			const snapshot = await getAutosaveSnapshot(row.autosaveKey);
			if (snapshot) {
				await persistProjectAutosave(row.autosaveKey, snapshot.data, snapshot.timestamp);
			}
		}
	}
	return rows
		.map((row) => {
			const snapshot = snapshots.get(row.autosaveKey);
			return snapshot && snapshot.timestamp > row.updatedAt
				? { ...row, updatedAt: snapshot.timestamp, size: snapshot.size }
				: row;
		})
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readProject(id: string): Promise<LocalProjectContent | null> {
	const row = await requestValue<LocalProject | undefined>('projects', (store) => store.get(id));
	if (!row) {
		return null;
	}
	const snapshot = await getAutosaveSnapshot(row.autosaveKey);
	if (snapshot && snapshot.timestamp > row.updatedAt) {
		await persistProjectAutosave(row.autosaveKey, snapshot.data, snapshot.timestamp);
		return {
			...row,
			updatedAt: snapshot.timestamp,
			size: snapshot.size,
			data: new Uint8Array(snapshot.data),
		};
	}
	const data = await requestValue<Uint8Array | undefined>('data', (store) => store.get(id));
	return data ? { ...row, data: new Uint8Array(data) } : null;
}

/** Idempotent, additive migration. Never deletes the old recovery records. */
export async function migrateProjects(session: SessionDeck | null): Promise<void> {
	const snapshots = await listAutosaveSnapshots();
	const keys = new Set(snapshots.map((snapshot) => snapshot.key));
	if (session) {
		keys.add(session.fileName);
	}
	for (const key of keys) {
		if (key.startsWith(PREFIX)) {
			continue;
		}
		const id = `legacy:${key}`;
		const existing = await requestValue<LocalProject | undefined>('projects', (store) =>
			store.get(id),
		);
		if (existing) {
			continue;
		}
		const snapshot = await getAutosaveSnapshot(key);
		const previous = session?.fileName === key ? session : null;
		const latest =
			snapshot && (!previous || snapshot.timestamp > previous.timestamp) ? snapshot : previous;
		if (!latest || latest.data.byteLength === 0) {
			continue;
		}
		await writeProject(
			{
				id,
				name: key,
				autosaveKey: key,
				updatedAt: latest.timestamp,
				size: latest.data.byteLength,
			},
			latest.data,
		);
	}
}
