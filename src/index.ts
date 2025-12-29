import { PORT } from "./utils/config";
import app from "./app"
import { stopScheduler } from "./services/scheduler";

process.on('uncaughtException', (error) => {
    console.error("Uncaught Exception:", error);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.log("Unhandled rejection: ", reason)
});

process.on('SIGINT', () => {
    console.log('Application shutting down...');
    stopScheduler();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`Application runing on port ${PORT}...`)
})