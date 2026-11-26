import crypto from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import { extractText } from 'unpdf';

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx', '.pptx']);
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_ARCHIVE_ENTRIES = 1000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 32 * 1024 * 1024;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;

export interface ParsedDocument {
  extractedText: string;
  checksum: string;
  detectedType: string;
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<a:p[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function validateZipArchiveLimits(buffer: Buffer): void {
  const searchStart = Math.max(0, buffer.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset--) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) {
    throw new Error('Invalid DOCX/PPTX archive: ZIP directory record is missing.');
  }

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const directoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const directorySize = buffer.readUInt32LE(eocdOffset + 12);
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const commentLength = buffer.readUInt16LE(eocdOffset + 20);
  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    eocdOffset + 22 + commentLength > buffer.length ||
    directoryOffset + directorySize > eocdOffset
  ) {
    throw new Error('Unsupported or malformed DOCX/PPTX archive directory.');
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`DOCX/PPTX archive contains too many entries (maximum ${MAX_ARCHIVE_ENTRIES}).`);
  }

  let totalUncompressedBytes = 0;
  let offset = directoryOffset;
  const directoryEnd = directoryOffset + directorySize;
  for (let index = 0; index < entryCount; index++) {
    if (
      offset + 46 > directoryEnd ||
      buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw new Error('Malformed DOCX/PPTX archive directory entry.');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + nameLength + extraLength + entryCommentLength;

    if (nextOffset > directoryEnd || (flags & 0x1) !== 0) {
      throw new Error('Encrypted or malformed DOCX/PPTX archive entries are not supported.');
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error('DOCX/PPTX archive uses an unsupported compression method.');
    }
    if (uncompressedBytes > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error('DOCX/PPTX archive entry exceeds the 32 MB extraction limit.');
    }
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new Error('DOCX/PPTX archive exceeds the 64 MB total extraction limit.');
    }
    if (compressedBytes === 0 && uncompressedBytes > 0) {
      throw new Error('Malformed DOCX/PPTX archive compression metadata.');
    }
    offset = nextOffset;
  }
  if (offset !== directoryEnd) {
    throw new Error('Malformed DOCX/PPTX archive directory size.');
  }
}

export function validateDocumentUpload(filename: string, buffer: Buffer): { ok: boolean; error?: string; ext?: string } {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: 'Unsupported file type. Allowed formats: PDF, DOCX, PPTX, TXT, MD.' };
  }
  if (buffer.length === 0) {
    return { ok: false, error: 'Uploaded file is empty.' };
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: 'File exceeds the 15 MB safety limit.' };
  }

  // Magic-byte signature checks for binary containers
  if (ext === '.pdf') {
    const header = buffer.subarray(0, 5).toString('ascii');
    if (!header.startsWith('%PDF-')) {
      return { ok: false, error: 'Invalid PDF file signature.' };
    }
  }
  if (ext === '.docx' || ext === '.pptx') {
    // ZIP magic bytes: PK\x03\x04
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      return { ok: false, error: `Invalid ${ext.toUpperCase()} archive signature.` };
    }
    try {
      validateZipArchiveLimits(buffer);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `Invalid ${ext.toUpperCase()} archive.`,
      };
    }
  }

  return { ok: true, ext };
}

export async function parseEducationalDocument(filename: string, buffer: Buffer): Promise<ParsedDocument> {
  const check = validateDocumentUpload(filename, buffer);
  if (!check.ok || !check.ext) {
    throw new Error(check.error ?? 'Invalid file');
  }

  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = check.ext;

  if (ext === '.txt' || ext === '.md') {
    const extractedText = buffer.toString('utf8').replace(/\0/g, '').trim();
    return { extractedText, checksum, detectedType: 'text/plain' };
  }

  if (ext === '.pdf') {
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    const extractedText = (Array.isArray(text) ? text.join('\n\n') : String(text ?? '')).trim();
    return {
      extractedText: extractedText || 'No selectable text extracted from PDF (file may contain scanned images).',
      checksum,
      detectedType: 'application/pdf',
    };
  }

  if (ext === '.docx') {
    const zip = await JSZip.loadAsync(buffer);
    const docFile = zip.file('word/document.xml');
    if (!docFile) {
      throw new Error('DOCX archive does not contain word/document.xml.');
    }
    const xml = await docFile.async('string');
    return {
      extractedText: stripXmlTags(xml),
      checksum,
      detectedType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  if (ext === '.pptx') {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => {
        const na = Number.parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10);
        const nb = Number.parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10);
        return na - nb;
      });

    const slideTexts: string[] = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.files[slideFiles[i]].async('string');
      const cleaned = stripXmlTags(xml);
      if (cleaned) {
        slideTexts.push(`Slide ${i + 1}:\n${cleaned}`);
      }
    }

    return {
      extractedText: slideTexts.join('\n\n') || 'No text content found in PPTX slides.',
      checksum,
      detectedType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
  }

  throw new Error('Unsupported document type.');
}
