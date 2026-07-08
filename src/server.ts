import { buildApp } from './app.js';

const start = async () => {
  try {
    const app = await buildApp();
    const port = Number(process.env.PORT) || 3001;
    const host = process.env.HOST || '0.0.0.0';

    app.listen(port, host, () => {
      console.log(`🚀 Servidor Express backend ejecutándose en http://${host}:${port}`);
    });
  } catch (err) {
    console.error('Error al iniciar el servidor:', err);
    process.exit(1);
  }
};

start();
