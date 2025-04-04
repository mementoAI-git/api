import fileUpload from "express-fileupload"

const fileUploadMiddleWare = fileUpload({
    limits: { fileSize: 1500 * 1024 * 1024 }, //1500MB = 1.5GB
    preserveExtension: true,
    safeFileNames: true,
    uriDecodeFileNames: true
})

export default fileUploadMiddleWare