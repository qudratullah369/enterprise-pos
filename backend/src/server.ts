import app from './app.js';
import { env } from './config/env.js';

const port = env.PORT;

app.listen(port, () => {
  console.log(`🚀 POS Backend running on http://localhost:${port}`);
  console.log(`   Environment: ${env.NODE_ENV}`);
});
