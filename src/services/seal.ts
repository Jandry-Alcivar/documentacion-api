import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { Procedure, Document, SystemSetting, AuditLog, ProcedureStatus } from '../models/index.js';

export type ImmutabilityMode = 'REOPEN' | 'LOCKED';
const MODE_KEY = 'immutability.mode';

export async function getImmutabilityMode(): Promise<ImmutabilityMode> {
  const row = await SystemSetting.findByPk(MODE_KEY);
  return row?.value === 'LOCKED' ? 'LOCKED' : 'REOPEN';
}

export async function setImmutabilityMode(mode: ImmutabilityMode) {
  await SystemSetting.upsert({ key: MODE_KEY, value: mode });
}

export function isAdminUser(user: any): boolean {
  return !!user && ((user.permissions || []).includes('all') || user.roleName === 'Administrador');
}

/** Huella SHA-256 determinística del trámite y todos sus documentos. */
export async function computeSeal(procedureId: string): Promise<string | null> {
  const p = await Procedure.findByPk(procedureId);
  if (!p) return null;
  const docs = await Document.findAll({ where: { procedureId }, order: [['id', 'ASC']] });
  const payload = {
    id: p.id, code: p.code, subject: p.subject, description: p.description,
    typeId: p.typeId, applicantName: p.applicantName, applicantId: p.applicantId ?? null,
    documents: docs.map((d: any) => ({
      id: d.id, title: d.title, description: d.description, typeId: d.typeId ?? null,
      status: d.status, fileUrl: d.fileUrl ?? null, fileHash: d.fileHash ?? null,
      content: d.content ?? null, deletedAt: d.deletedAt ? new Date(d.deletedAt).toISOString() : null,
      signatures: d.signatures ?? []
    }))
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function logAudit(req: Request, action: string, recordId: string, details: string) {
  const user: any = (req as any).user;
  if (!user?.id) return;
  await AuditLog.create({
    userId: user.id, module: 'Inmutabilidad', action, recordId,
    ipAddress: req.ip || '127.0.0.1', details
  }).catch(() => {});
}

export function isSealed(p: any): boolean {
  return !!p && (p.status === ProcedureStatus.FINALIZADO || !!p.sealHash);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function reject(req: Request, res: Response, p: any) {
  await logAudit(req, 'TAMPER_ATTEMPT', p.id,
    `Intento de modificar trámite sellado ${p.code}: ${req.method} ${req.originalUrl}`);
  return res.status(423).json({ error: `Trámite ${p.code} finalizado y sellado. No se permiten modificaciones.`, sealed: true });
}

/** Guard para rutas /api/procedures/:id/... */
export const guardProcedureSealed = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) return next();
    const p = await Procedure.findByPk(id);
    if (p && isSealed(p)) return reject(req, res, p);
    next();
  } catch (e) { next(e); }
};

/** Guard para rutas /api/documents/:id/... (documento perteneciente a trámite sellado). */
export const guardDocumentSealed = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method === 'GET' || req.originalUrl.split('?')[0].endsWith('/verify')) return next();
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) return next();
    const d: any = await Document.findByPk(id, { attributes: ['id', 'procedureId'] });
    if (d?.procedureId) {
      const p = await Procedure.findByPk(d.procedureId);
      if (p && isSealed(p)) return reject(req, res, p);
    }
    next();
  } catch (e) { next(e); }
};
