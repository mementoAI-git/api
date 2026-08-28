import type {Application} from 'express';
import swaggerUi from 'swagger-ui-express';
import {buildOpenApiDocument} from '../contracts/openapi';
import {BACKEND_URL} from '../utils/config';

const setupSwagger = (app: Application): void => {
  const specification = buildOpenApiDocument(
    BACKEND_URL || 'http://localhost:5000',
  );
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(specification, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'Memento API Documentation',
    }),
  );
};

export default setupSwagger;
