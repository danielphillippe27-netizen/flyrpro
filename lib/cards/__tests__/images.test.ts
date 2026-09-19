import assert from 'node:assert/strict';
import sharp from 'sharp';
import {prepareCardImage,CARD_IMAGE_LIMIT} from '../images';
async function main(){
 const png=await sharp({create:{width:2000,height:1000,channels:4,background:{r:255,g:0,b:0,alpha:0.5}}}).png().withMetadata().toBuffer();
 const result=await prepareCardImage(png);const meta=await sharp(result).metadata();
 assert.equal(meta.format,'webp');assert.equal(meta.width,1600);assert.equal(meta.height,800);assert.equal(meta.hasAlpha,true);assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);
 const rotated=await sharp({create:{width:100,height:50,channels:3,background:'red'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const orientation=await sharp(await prepareCardImage(rotated)).metadata();assert.equal(orientation.width,50);assert.equal(orientation.height,100);
 await assert.rejects(prepareCardImage(Buffer.from('invalid image')));
 await assert.rejects(prepareCardImage(Buffer.alloc(CARD_IMAGE_LIMIT+1)));
 console.log('Card image tests passed: resize, transparency, orientation, metadata removal, invalid images, upload limit');
}
main();
