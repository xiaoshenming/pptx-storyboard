# Local project library and dismissible video progress

> **For agentic workers:** Use superpowers:executing-plans for inline implementation.

**Goal:** Refresh opens a local project library; users can import, create, reopen and return without losing saved edits. Video progress dismisses on outside pointer or Escape and reopens without cancelling generation.

**Architecture:** Persist project metadata and bytes in an independent IndexedDB store. Give new imports distinct IDs and autosave keys, merge newer recovery snapshots when opening/listing, and migrate the previous session and available recovery records idempotently. Keep collaboration and audience launch behavior. Use the viewer's getContent handle before returning to the library. Scope new storyboard state to project IDs while migrated decks retain their historical storyboard identity.

**Tech Stack:** React, TypeScript, IndexedDB, Vitest, fake-indexeddb.

**Spec:** User-approved behavior in this task on 2026-09-21: outside click/Escape collapse, reopen progress; refresh to local project list with name and modified time, import/new, return entry, migrate available records.

## Global Constraints

- Closing progress never calls cancel.
- Browser-local storage; no cloud synchronization or deletion of old data.
- Existing capture optimization remains intact.
- ZIP checkout has no Git metadata, so validation and file review replace commits/worktree tooling.

## Review Focus

- Duplicate filenames must remain distinct projects and storyboard states.
- Refresh must preserve latest autosaved edits without auto-opening a deck.
- Storage failure must be visible and returning must not discard edits.
- Migration must not duplicate projects on each refresh or restore stale bytes.
- Click inside progress stays open; outside and Escape dismiss; new jobs open.

### Task 1: Dismissible progress

- [x] Add component behavior tests in StoryboardJobStatus.test.tsx and run RED.
- [x] Add capture-phase outside pointer/Escape listeners, stable reopen control, per-job reset and accessible expanded state.
- [x] Run tests GREEN and typecheck.

### Task 2: Project persistence

- [x] Add shared/render/project-library.test.ts with duplicate names, migration idempotence, newest snapshot, persistence failure tests; run RED.
- [x] Implement project-library.ts: createProject(name, bytes), saveProject(project, bytes), readProject(id), listProjects(), migrateProjects(). Writes resolve only after transaction commit; errors propagate.
- [x] Run tests GREEN.

### Task 3: Demo integration

- [x] Add demo project-library UI/hook; initialize/migrate without opening; remove previous recovery banner and automatic restoration.
- [x] Import/new create a record; open selects its ID and newest bytes; return serializes before unmounting. Use distinct filePath and storyboardProjectKey.
- [x] Verify browser refresh, reopen, return, creation and progress dismissal; run targeted suites/typecheck/lint.
- [x] Independent review of changed files, fix material findings, report mechanism and browser-local limitations.

## Completion evidence

32 files / 384 tests passed; final identity change additionally verified by 28 tests. React typecheck, shared build and changed-file lint passed. Browser workflows verified; see ../.. and D:/1AAAworkproject/pptx-storyboard-local/项目列表与进度层验证.md for complete evidence and existing limitations. Independent review fixes: durable autosave promotion (RED to GREEN) and sample bootstrap state reset (browser RED to GREEN). No Git cleanup applicable.
