import {
  generateUploadButton,
  generateUploadDropzone,
} from "@uploadthing/react";
 
// Stub type for file router - TODO: Create actual uploadthing API route
type OurFileRouter = {
  [key: string]: any;
};
 
export const UploadButton = generateUploadButton<OurFileRouter>();
export const UploadDropzone = generateUploadDropzone<OurFileRouter>();
