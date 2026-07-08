import { Router } from 'express';
import { ProcedureType, DocumentType } from '../models/index.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

// --- Tipos de Trámite ---
router.get('/procedure-types', async (req, res) => {
  try {
    const raw = await ProcedureType.findAll({
      order: [['name', 'ASC']],
      include: [{ association: 'procedures', attributes: ['id'] }]
    });

    const result = raw.map((item: any) => {
      const json = item.toJSON();
      const count = json.procedures ? json.procedures.length : 0;
      delete json.procedures;
      return {
        ...json,
        _count: { procedures: count }
      };
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/procedure-types', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  const { name, description, estimatedDays, isActive } = req.body as any;

  try {
    const created = await ProcedureType.create({
      name,
      description,
      estimatedDays: estimatedDays || 0,
      isActive: isActive ?? true
    });
    return res.status(201).json(created);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.put('/procedure-types/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  const id = req.params.id as string;
  const data = req.body as any;

  try {
    const procedureType = await ProcedureType.findByPk(id);
    if (!procedureType) return res.status(404).json({ error: 'Tipo de trámite no encontrado.' });

    await procedureType.update(data);
    return res.json(procedureType);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// --- Tipos de Documento ---
router.get('/document-types', async (req, res) => {
  try {
    const raw = await DocumentType.findAll({
      order: [['name', 'ASC']],
      include: [
        { association: 'documents', attributes: ['id'] },
        { association: 'templates', attributes: ['id'] }
      ]
    });

    const result = raw.map((item: any) => {
      const json = item.toJSON();
      const docCount = json.documents ? json.documents.length : 0;
      const tempCount = json.templates ? json.templates.length : 0;
      delete json.documents;
      delete json.templates;
      return {
        ...json,
        _count: { documents: docCount, templates: tempCount }
      };
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/document-types', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  const { name, description, isActive } = req.body as any;

  try {
    const created = await DocumentType.create({
      name,
      description,
      isActive: isActive ?? true
    });
    return res.status(201).json(created);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

router.put('/document-types/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  const id = req.params.id as string;
  const data = req.body as any;

  try {
    const docType = await DocumentType.findByPk(id);
    if (!docType) return res.status(404).json({ error: 'Tipo de documento no encontrado.' });

    await docType.update(data);
    return res.json(docType);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
