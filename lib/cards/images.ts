export const CARD_IMAGE_LIMIT=3*1024*1024;
export async function prepareCardImage(bytes:Buffer){
 if(!bytes.length||bytes.length>CARD_IMAGE_LIMIT)throw new Error('Choose an image smaller than 3 MB');
 const {default:sharp}=await import('sharp');
 return sharp(bytes,{limitInputPixels:40_000_000,animated:false}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer();
}
