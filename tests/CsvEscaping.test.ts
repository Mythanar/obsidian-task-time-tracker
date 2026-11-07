// tests/CsvEscaping.test.ts
// Names with ";", commas, quotes and line breaks stay whole, each in its
// own column, in the Toggl and Clockify CSVs (RFC 4180: comma separator,
// fields with a quote, comma or line break are quoted). ";" needs no
// quoting. The generic CSV uses the same rule; it's left out here only
// because its headers come from i18n (Obsidian's moment).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTogglCsv } from "../src/export/adapters/TogglCsvAdapter";
import { buildClockifyCsv } from "../src/export/adapters/ClockifyCsvAdapter";

// Minimal RFC 4180 reader, enough to check the files round-trip.
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') {
				quoted = false;
			} else {
				field += c;
			}
		} else if (c === '"') {
			quoted = true;
		} else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\r" && text[i + 1] === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
			i++;
		} else {
			field += c;
		}
	}
	return rows;
}

const NAMES: [string, string][] = [
	["Design; Josh Market", "Acme, Inc."],
	['Say "hi" app', "Line one\nLine two"],
	["Plain", 'Client; with, all "three"\r\nand CRLF'],
];

function check(csv: string): void {
	const [header, ...body] = parseCsv(csv);
	const project = header?.indexOf("Project") ?? -1;
	const client = header?.indexOf("Client") ?? -1;
	assert.equal(body.length, NAMES.length);
	for (const [i, row] of body.entries()) {
		assert.equal(row.length, header?.length);
		assert.deepEqual([row[project], row[client]], NAMES[i]);
	}
}

const base = { email: "a@b.co", startDate: "2026-10-01", startTime: "09:00:00" };

describe("CSV export with unusual names", () => {
	it("Toggl keeps each name whole in its column", () => {
		check(
			buildTogglCsv(
				NAMES.map(([projectName, clientName], i) => ({ ...base, duration: "01:00:00", description: `T ${i}`, projectName, clientName })),
				true,
			),
		);
	});

	it("Clockify keeps each name whole in its column", () => {
		check(
			buildClockifyCsv(
				NAMES.map(([projectName, clientName], i) => ({ ...base, duration: "01:00", description: `T ${i}`, projectName, clientName })),
				true,
				true,
			),
		);
	});
});
