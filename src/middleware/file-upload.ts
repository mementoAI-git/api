import fileUpload from "express-fileupload"

const fileUploadMiddleWare = fileUpload({
    limits: { fileSize: 15 * 1024 * 1024 }, //15MB
    preserveExtension: true,
    safeFileNames: true,
    uriDecodeFileNames: true
})

export default fileUploadMiddleWare