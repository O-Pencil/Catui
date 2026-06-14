import assert from "node:assert/strict";
import test from "node:test";

// Test Session Tag API - TagEntry type and session tagging.

import { SessionManager } from "../core/session/session-manager.js";

test("SessionManager has appendTagChange method", () => {
	const sm = SessionManager.inMemory();
	assert.equal(typeof sm.appendTagChange, "function");
});

test("SessionManager has getSessionTags method", () => {
	const sm = SessionManager.inMemory();
	assert.equal(typeof sm.getSessionTags, "function");
});

test("getSessionTags returns empty array when no tags", () => {
	const sm = SessionManager.inMemory();
	const tags = sm.getSessionTags();
	assert.deepEqual(tags, []);
});

test("appendTagChange stores tags", () => {
	const sm = SessionManager.inMemory();
	sm.appendTagChange(["important", "bug-fix"]);
	const tags = sm.getSessionTags();
	assert.deepEqual(tags, ["important", "bug-fix"]);
});

test("getSessionTags returns latest tags", () => {
	const sm = SessionManager.inMemory();
	sm.appendTagChange(["old-tag"]);
	sm.appendTagChange(["new-tag-1", "new-tag-2"]);
	const tags = sm.getSessionTags();
	assert.deepEqual(tags, ["new-tag-1", "new-tag-2"]);
});

test("appendTagChange trims and filters empty tags", () => {
	const sm = SessionManager.inMemory();
	sm.appendTagChange(["  good  ", "", "  also-good  "]);
	const tags = sm.getSessionTags();
	assert.deepEqual(tags, ["good", "also-good"]);
});

test("TagEntry persists in session file", () => {
	const sm = SessionManager.inMemory();
	sm.appendTagChange(["persist-test"]);
	const entries = sm.getEntries();
	const tagEntry = entries.find((e) => e.type === "tag");
	assert.ok(tagEntry, "should have a tag entry");
	assert.deepEqual((tagEntry as any).tags, ["persist-test"]);
});

test("TagEntry has correct structure", () => {
	const sm = SessionManager.inMemory();
	const id = sm.appendTagChange(["test"]);
	const entries = sm.getEntries();
	const tagEntry = entries.find((e) => e.id === id) as any;
	assert.ok(tagEntry);
	assert.equal(tagEntry.type, "tag");
	assert.ok(tagEntry.id);
	// parentId may be null for the first entry in an in-memory session
	assert.ok(tagEntry.timestamp);
	assert.deepEqual(tagEntry.tags, ["test"]);
});
