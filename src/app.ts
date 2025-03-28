import express from 'express'
import helmet from 'helmet';
import cors from 'cors';
import compression from "compression"
import router from './module';
import { connectMongodb } from './services/mogodb';
import requestLogger from './middleware/request-logger';

connectMongodb();

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

app.use(requestLogger);

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

router(app);

app.disable('x-powered-by')
export default app