import { UploadedFile } from "express-fileupload";

export async function uploadFile(files: UploadedFile[]) {
  console.log(files)
  return { message: "File uploaded successfully", data: null }
}