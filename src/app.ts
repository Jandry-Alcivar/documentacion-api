import express from 'express';
import cors from 'cors';
import * as path from 'path';

// Instancia de Sequelize
import { sequelize } from './models/index.js';

// Rutas de Express
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import departmentRoutes from './routes/departments.js';
import templateRoutes from './routes/templates.js';
import documentRoutes from './routes/documents.js';
import alertRoutes from './routes/alerts.js';
import configRoutes from './routes/config.js';
import roleRoutes from './routes/roles.js';
import catalogRoutes from './routes/catalogs.js';
import procedureRoutes from './routes/procedures.js';
import auditRoutes from './routes/audit.js';
import reportsRoutes from './routes/reports.js';
import { ensureStorageDirs } from './utils/storage.js';

export async function buildApp() {
  const app = express();

  // Asegurar carpetas de subida de archivos
  ensureStorageDirs();

  // Configurar CORS
  app.use(cors({
    origin: '*', // En producción delimitar a los dominios del frontend
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  // Middlewares para analizar el cuerpo de la solicitud
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Configurar archivos estáticos (para descargar documentos y plantillas)
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  // Inicializar base de datos con Sequelize
  try {
    await sequelize.authenticate();
    console.log('Conexión con PostgreSQL establecida correctamente usando Sequelize.');

    await sequelize.sync({ alter: true });
    console.log('Modelos de Sequelize sincronizados con la base de datos.');
  } catch (error) {
    console.error('No se pudo establecer la conexión a la base de datos:', error);
    throw error;
  }

  // Registrar Rutas
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/departments', departmentRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/alerts', alertRoutes);
  app.use('/api/config', configRoutes);
  app.use('/api/roles', roleRoutes);
  app.use('/api/catalogs', catalogRoutes);
  app.use('/api/procedures', procedureRoutes);
  app.use('/api/audit-logs', auditRoutes);
  app.use('/api/reports', reportsRoutes);

  return app;
}
