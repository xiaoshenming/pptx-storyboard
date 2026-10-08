import JSZip from 'jszip';
import { expect, test } from 'vitest';

import { extractEmbeddedWordText } from './embedded-word-text';

test('extracts Word paragraphs and flags embedded equations that are not text', async () => {
	const zip = new JSZip();
	zip.file(
		'word/document.xml',
		'<w:document><w:body><w:p><w:r><w:t>体积</w:t></w:r><w:object/></w:p></w:body></w:document>',
	);
	const result = await extractEmbeddedWordText(
		`data:application/octet-stream;base64,${await zip.generateAsync({ type: 'base64' })}`,
	);
	expect(result.text).toContain('体积');
	expect(result.incomplete).toBeTruthy();
});

test('marks unsupported structured math instead of silently concatenating it', async () => {
	const zip = new JSZip();
	zip.file(
		'word/document.xml',
		'<w:document><w:body><m:oMath><m:nary><m:naryPr/><m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath></w:body></w:document>',
	);
	const result = await extractEmbeddedWordText(
		`data:application/octet-stream;base64,${await zip.generateAsync({ type: 'base64' })}`,
	);
	expect(result.incomplete).toBeTruthy();
	expect(result.text).toContain('未提取');
	expect(result.text).not.toContain('i=1x');
});
