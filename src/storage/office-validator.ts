import * as CFB from 'cfb';
import CRC32 from 'crc-32';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { fromBuffer, type Entry } from 'yauzl';
const DOCUMENTS: Record<string, { path: string; contentType: string }> = {
  docx: {
    path: 'word/document.xml',
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  },
  xlsx: {
    path: 'xl/workbook.xml',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  },
  pptx: {
    path: 'ppt/presentation.xml',
    contentType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  },
};

function validatePowerPointRecords(bytes: Buffer) {
  let records = 0;
  const walk = (start: number, end: number, depth: number) => {
    if (depth > 32) throw new Error('PPT nesting limit');
    for (let offset = start; offset < end;) {
      if (offset + 8 > end || ++records > 100000)
        throw new Error('Invalid PPT record');
      const version = bytes.readUInt16LE(offset) & 0x0f;
      const type = bytes.readUInt16LE(offset + 2);
      const length = bytes.readUInt32LE(offset + 4);
      const recordEnd = offset + 8 + length;
      if (recordEnd > end) throw new Error('Truncated PPT record');
      // MS-PPT RT_ExternalOleObjectStg stores embedded OLE, VBA or ActiveX,
      // including compressed VBA that is invisible to the outer compound directory.
      if (type === 0x1011 || type === 0x0fc3)
        throw new Error('Embedded PPT object');
      if (
        type === 0x0400 &&
        (length < 12 || bytes.readUInt32LE(offset + 12) !== 0)
      )
        throw new Error('PPT VBA macro');
      if (version === 0x0f) walk(offset + 8, recordEnd, depth + 1);
      offset = recordEnd;
    }
  };
  walk(0, bytes.length, 0);
}

function validateCompound(buffer: Buffer, extension: string) {
  if (!buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')))
    throw new Error('Invalid OLE signature');
  const compound = CFB.read(buffer, { type: 'buffer' });
  const paths = compound.FullPaths.map((p) => p.toLowerCase());
  if (
    paths.some((p) =>
      /(?:^|\/)(?:vba|_vba_project[^/]*|macros|objectpool|encryptedpackage|encryptioninfo)(?:\/|$)/i.test(
        p,
      ),
    )
  )
    throw new Error('Macro, encrypted or embedded document');
  const stream =
    extension === 'doc'
      ? 'WordDocument'
      : extension === 'xls'
        ? 'Workbook'
        : 'PowerPoint Document';
  const content =
    CFB.find(compound, stream) ??
    (extension === 'xls' ? CFB.find(compound, 'Book') : null);
  if (!content?.content?.length) throw new Error('Missing document stream');
  const bytes = Buffer.from(content.content);
  if (
    extension === 'doc' &&
    (bytes.length < 12 ||
      bytes.readUInt16LE(0) !== 0xa5ec ||
      (bytes.readUInt16LE(10) & 0x8100) !== 0)
  )
    throw new Error('Invalid or encrypted Word document');
  if (extension === 'xls') {
    if (
      bytes.length < 8 ||
      ![0x0809, 0x0409, 0x0209, 0x0009].includes(bytes.readUInt16LE(0))
    )
      throw new Error('Invalid Excel BOF');
    for (let offset = 0; offset + 4 <= bytes.length;) {
      const record = bytes.readUInt16LE(offset);
      const length = bytes.readUInt16LE(offset + 2);
      if (record === 0x002f || record === 0x00d3)
        throw new Error('Encrypted or macro Excel document');
      if (record === 0x0085 && length >= 6 && bytes[offset + 9] === 1)
        throw new Error('Excel 4 macro sheet');
      if (offset + 4 + length > bytes.length)
        throw new Error('Truncated BIFF record');
      offset += 4 + length;
    }
  }
  if (
    extension === 'ppt' &&
    (bytes.length < 8 ||
      bytes.readUInt32LE(4) > bytes.length - 8 ||
      bytes.readUInt16LE(2) < 0x03e8)
  )
    throw new Error('Invalid PowerPoint stream');
  if (extension === 'ppt') validatePowerPointRecords(bytes);
}

function validateOpenXml(buffer: Buffer, extension: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new Error('Invalid ZIP'));
          return;
        }
        let entries = 0;
        let totalBytes = 0;
        const names = new Set<string>();
        let contentTypes = '';
        let hasDocument = false;
        let hasRelationships = false;
        let failed = false;
        const fail = (err: Error) => {
          if (!failed) {
            failed = true;
            zip.close();
            reject(err);
          }
        };
        zip.on('error', fail);
        zip.on('end', () => {
          if (failed) return;
          if (
            !hasDocument ||
            !hasRelationships ||
            !contentTypes.includes(DOCUMENTS[extension].contentType) ||
            !contentTypes.includes(`/${DOCUMENTS[extension].path}`)
          ) {
            fail(new Error('Missing Office structure'));
            return;
          }
          resolve();
        });
        zip.on('entry', (entry: Entry) => {
          if (failed) return;
          entries++;
          totalBytes += entry.uncompressedSize;
          const name = entry.fileName;
          if (
            entries > 5000 ||
            totalBytes > 100 * 1024 * 1024 ||
            entry.uncompressedSize > 30 * 1024 * 1024 ||
            (entry.uncompressedSize > 1024 * 1024 &&
              entry.uncompressedSize / Math.max(entry.compressedSize, 1) > 200)
          ) {
            fail(new Error('ZIP decompression limit'));
            return;
          }
          if (
            entry.generalPurposeBitFlag & 1 ||
            names.has(name.toLowerCase()) ||
            name.includes('..') ||
            name.startsWith('/') ||
            /(?:vbaproject|vba\/|macrosheets\/|activex\/|embeddings\/|\.exe$|\.dll$|\.com$|\.js$|\.vbs$)/i.test(
              name,
            )
          ) {
            fail(new Error('Unsafe Office package'));
            return;
          }
          names.add(name.toLowerCase());
          if (name === DOCUMENTS[extension].path) hasDocument = true;
          if (name === '_rels/.rels') hasRelationships = true;
          if (name.endsWith('/')) {
            zip.readEntry();
            return;
          }
          // Consume all members so truncated/invalid compressed data cannot hide behind a valid directory.
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) {
              fail(err ?? new Error('Invalid ZIP member'));
              return;
            }
            const capture =
              name === '[Content_Types].xml' ||
              name === DOCUMENTS[extension].path ||
              name.endsWith('.rels');
            const chunks: Buffer[] = [];
            let length = 0;
            let crc = 0;
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => {
              length += chunk.length;
              crc = CRC32.buf(chunk, crc);
              if (
                length > 30 * 1024 * 1024 ||
                (name === '[Content_Types].xml' && length > 1024 * 1024)
              ) {
                stream.destroy();
                fail(new Error('XML exceeds limit'));
                return;
              }
              if (capture) chunks.push(chunk);
            });
            stream.on('end', () => {
              if (failed) return;
              if (
                length !== entry.uncompressedSize ||
                crc >>> 0 !== entry.crc32
              ) {
                fail(new Error('Invalid ZIP size or CRC'));
                return;
              }
              if (capture) {
                const xml = Buffer.concat(chunks).toString('utf8');
                if (
                  /<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject|attachedTemplate/i.test(
                    xml,
                  ) ||
                  XMLValidator.validate(xml) !== true
                ) {
                  fail(new Error('Unsafe or invalid XML'));
                  return;
                }
                if (name === '[Content_Types].xml') contentTypes = xml;
                if (name === DOCUMENTS[extension].path) {
                  const parsed = new XMLParser({
                    removeNSPrefix: true,
                    ignoreAttributes: false,
                  }).parse(xml) as Record<string, unknown>;
                  const root =
                    extension === 'docx'
                      ? 'document'
                      : extension === 'xlsx'
                        ? 'workbook'
                        : 'presentation';
                  if (!(root in parsed)) {
                    fail(new Error('Invalid main XML'));
                    return;
                  }
                }
              }
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}

export async function validateOfficeContent(buffer: Buffer, extension: string) {
  if (DOCUMENTS[extension]) await validateOpenXml(buffer, extension);
  else validateCompound(buffer, extension);
}
