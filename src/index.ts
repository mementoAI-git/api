import { PORT } from "./utils/config";
import app from "./app"
import logger from "./utils/logger";

process.on('uncaughtException', (error) => {
    logger.error(error, "Uncaught Exception");
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error(reason, "Unhandled rejection");
});

process.on('SIGINT', () => {
    logger.info('Application shutting down...');
    process.exit(0);
});

app.listen(PORT, () => {
    logger.info(`Application runing on port ${PORT}...`)
})