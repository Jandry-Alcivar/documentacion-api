import * as fs from 'fs';
import * as path from 'path';

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const DOCUMENTS_DIR = path.join(UPLOADS_DIR, 'documents');

// Asegurar que las carpetas existen
export function ensureStorageDirs() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(DOCUMENTS_DIR)) {
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  }
}

/**
 * Guarda un buffer de archivo en la carpeta de documentos
 * @returns El path relativo accesible desde static
 */
export async function saveDocumentFile(filename: string, buffer: Buffer): Promise<{ relativeUrl: string; absolutePath: string }> {
  ensureStorageDirs();
  
  // Agregar timestamp para evitar colisiones
  const uniqueName = `${Date.now()}-${filename.replace(/\s+/g, '_')}`;
  const absolutePath = path.join(DOCUMENTS_DIR, uniqueName);
  
  await fs.promises.writeFile(absolutePath, buffer);
  
  return {
    relativeUrl: `/uploads/documents/${uniqueName}`,
    absolutePath
  };
}

/**
 * Obtiene la ruta física absoluta a partir de un URL relativo de uploads
 */
export function getAbsolutePathFromUrl(relativeUrl: string): string {
  const cleanUrl = relativeUrl.replace(/^\/uploads\//, '');
  return path.join(UPLOADS_DIR, cleanUrl);
}

/**
 * Elimina un archivo físico si existe
 */
export async function deletePhysicalFile(relativeUrl: string): Promise<boolean> {
  try {
    const absolutePath = getAbsolutePathFromUrl(relativeUrl);
    if (fs.existsSync(absolutePath)) {
      await fs.promises.unlink(absolutePath);
      return true;
    }
  } catch (error) {
    console.error(`Error deleting physical file at ${relativeUrl}:`, error);
  }
  return false;
}
