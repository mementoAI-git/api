process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters';
process.env.FILE_URL_SIGNING_KEYS =
  'test-v1:test-file-signing-secret-at-least-32-characters,' +
  'test-v0:test-previous-file-signing-secret-at-least-32-characters';
process.env.BACKEND_URL = 'http://localhost:5000';
