/**
 * [WHO]: extractPdfPages
 * [FROM]: Depends on pdf-lib
 * [TO]: Consumed by ./read.ts for PDF page extraction
 * [HERE]: core/tools/pdf-extract.ts - extract specific pages from a PDF buffer
 */

import { PDFDocument } from "pdf-lib";

const MAX_PAGES = 20;

/**
 * Parse a page range string like "1-5", "3", "10-20" into an array of 0-indexed page indices.
 */
function parsePageRange(range: string, totalPages: number): number[] {
	const parts = range.split(",").map((s) => s.trim());
	const pages: number[] = [];

	for (const part of parts) {
		if (part.includes("-")) {
			const [startStr, endStr] = part.split("-").map((s) => s.trim());
			const start = parseInt(startStr, 10);
			const end = parseInt(endStr, 10);
			if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
				throw new Error(`Invalid page range: ${part}`);
			}
			for (let i = start; i <= Math.min(end, totalPages); i++) {
				pages.push(i - 1); // 0-indexed
			}
		} else {
			const page = parseInt(part, 10);
			if (isNaN(page) || page < 1) {
				throw new Error(`Invalid page number: ${part}`);
			}
			if (page <= totalPages) {
				pages.push(page - 1); // 0-indexed
			}
		}
	}

	if (pages.length === 0) {
		throw new Error("No valid pages in range");
	}

	// Deduplicate and sort
	const unique = [...new Set(pages)].sort((a, b) => a - b);
	return unique.slice(0, MAX_PAGES);
}

/**
 * Extract specific pages from a PDF buffer and return a new PDF as base64.
 * Uses pdf-lib to copy selected pages into a new PDF document.
 */
export async function extractPdfPages(pdfBuffer: Buffer, pageRange: string): Promise<string> {
	const srcDoc = await PDFDocument.load(pdfBuffer);
	const totalPages = srcDoc.getPageCount();
	const pageIndices = parsePageRange(pageRange, totalPages);

	const dstDoc = await PDFDocument.create();
	const copiedPages = await dstDoc.copyPages(srcDoc, pageIndices);
	for (const page of copiedPages) {
		dstDoc.addPage(page);
	}

	const pdfBytes = await dstDoc.save();
	return Buffer.from(pdfBytes).toString("base64");
}
