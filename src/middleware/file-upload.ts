import fileUpload from "express-fileupload"
import { TEMP_PATH } from "../utils/config"

const fileUploadMiddleWare = fileUpload({
    limits: { fileSize: 1500 * 1024 * 1024 }, //1500MB = 1.5GB
    tempFileDir: String(TEMP_PATH),
    useTempFiles: true,
    preserveExtension: true,
    safeFileNames: true,
    uriDecodeFileNames: true
})

export default fileUploadMiddleWare