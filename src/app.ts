import express from 'express'
import helmet from 'helmet';
import cors from 'cors';
import compression from "compression"
import router from './module/api';
import { connectMongodb } from './module/database/connection';
import redis from "./services/redis"
import path from 'path';
import setupSwagger from './docs';
import { initializeScheduler } from './services/scheduler';
import { httpLogger } from './middleware/http-logger';
import { setupBullBoard } from './services/queues';

redis.connect();
connectMongodb();
initializeScheduler();

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: '*',
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "100mb" }));
app.use('/assets', express.static(path.join(process.cwd(), 'public')));

app.use(httpLogger);
setupBullBoard(app)

app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
}))

// app.use(rateLimiter(1, 100))
setupSwagger(app);
router(app);

app.disable('x-powered-by')
export default app