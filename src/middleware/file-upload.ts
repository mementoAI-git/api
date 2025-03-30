import fileUpload from "express-fileupload"

const fileUploadMiddleWare = fileUpload({
    limits: { fileSize: 1500 * 1024 * 1024 },
    useTempFiles: true,
    preserveExtension: true,
    safeFileNames: true,
    uriDecodeFileNames: true
})

export default fileUploadMiddleWare