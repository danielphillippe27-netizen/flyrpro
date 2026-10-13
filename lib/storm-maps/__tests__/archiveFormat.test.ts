import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {meshReferenceTime,reportCollectionStart,collectionWindow} from '../intelligence/archive-format';
const grib=Buffer.alloc(37);grib.write('GRIB');grib[7]=2;grib.writeUInt32BE(21,16);grib[20]=1;grib.writeUInt16BE(2026,28);grib[30]=10;grib[31]=12;grib[32]=0;grib[33]=30;
assert.equal(meshReferenceTime(gzipSync(grib)).toISOString(),'2026-10-12T00:30:00.000Z');
assert.throws(()=>meshReferenceTime(gzipSync(Buffer.from('not a grid'))));
assert.equal(reportCollectionStart(new Date('2027-01-02T23:00:00Z')).toISOString(),'2026-12-27T00:00:00.000Z');
assert.equal(collectionWindow(new Date('2026-10-12T00:01:00Z')),collectionWindow(new Date('2026-10-12T00:59:00Z')));
console.log('Hail grid validation, reference timestamp, lookback and hourly deduplication keys passed');
