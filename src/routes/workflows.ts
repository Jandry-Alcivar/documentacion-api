import { Router } from 'express';
import { Workflow, WorkflowNode, Department, ProcedureType, AuditLog } from '../models/index.js';
import { authenticate, requirePermission } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

// Listar flujos
router.get('/', async (req, res) => {
  try {
    const list = await Workflow.findAll({
      include: [
        { association: 'procedureType', attributes: ['name'] },
        { association: 'nodes', include: [{ association: 'department', attributes: ['name'] }] }
      ],
      order: [['createdAt', 'DESC']]
    });
    return res.json(list);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Obtener un flujo
router.get('/:id', async (req, res) => {
  try {
    const flow = await Workflow.findByPk(req.params.id, {
      include: [
        { association: 'procedureType', attributes: ['name'] },
        { association: 'nodes', include: [{ association: 'department', attributes: ['name'] }] }
      ]
    });
    if (!flow) return res.status(404).json({ error: 'Flujo no encontrado.' });
    return res.json(flow);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Crear flujo
router.post('/', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  const { name, description, procedureTypeId, isActive } = req.body as any;

  if (!name || !procedureTypeId) {
    return res.status(400).json({ error: 'Faltan campos obligatorios.' });
  }

  try {
    const exists = await Workflow.findOne({ where: { procedureTypeId } });
    if (exists) {
      return res.status(400).json({ error: 'Ya existe un flujo asociado a este tipo de trámite.' });
    }

    const created = await Workflow.create({
      name,
      description,
      procedureTypeId,
      isActive: isActive ?? true
    });

    await AuditLog.create({
      userId: req.user!.id,
      module: 'Flujos',
      action: 'Crear Flujo',
      recordId: created.id,
      ipAddress: req.ip || '127.0.0.1',
      details: `Se creó el flujo de trámite: ${name}`
    });

    return res.status(201).json(created);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Actualizar flujo
router.put('/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const flow = await Workflow.findByPk(req.params.id as string);
    if (!flow) return res.status(404).json({ error: 'Flujo no encontrado.' });

    await flow.update(req.body);

    await AuditLog.create({
      userId: req.user!.id,
      module: 'Flujos',
      action: 'Actualizar Flujo',
      recordId: flow.id,
      ipAddress: req.ip || '127.0.0.1',
      details: `Se actualizó el flujo de trámite: ${flow.name}`
    });

    return res.json(flow);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Eliminar flujo
router.delete('/:id', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const flow = await Workflow.findByPk(req.params.id as string);
    if (!flow) return res.status(404).json({ error: 'Flujo no encontrado.' });

    await flow.destroy();

    await AuditLog.create({
      userId: req.user!.id,
      module: 'Flujos',
      action: 'Eliminar Flujo',
      recordId: req.params.id,
      ipAddress: req.ip || '127.0.0.1',
      details: `Se eliminó el flujo de trámite ID: ${req.params.id}`
    });

    return res.json({ message: 'Flujo eliminado correctamente.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// --- NODOS DEL FLUJO ---

// Listar nodos de un flujo
router.get('/:id/nodes', async (req, res) => {
  try {
    const nodes = await WorkflowNode.findAll({
      where: { workflowId: req.params.id },
      include: [{ association: 'department', attributes: ['name'] }],
      order: [['createdAt', 'ASC']]
    });
    return res.json(nodes);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Agregar nodo a un flujo
router.post('/:id/nodes', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  const { name, departmentId, maxHours, isStart, isEnd, requiredDocTypes, requiredActivities, typeEnvio } = req.body as any;

  if (!name || !departmentId) {
    return res.status(400).json({ error: 'Nombre y departamento son requeridos.' });
  }

  try {
    const flow = await Workflow.findByPk(req.params.id as string);
    if (!flow) return res.status(404).json({ error: 'Flujo no encontrado.' });

    // Si es start, validar que no exista otro start
    if (isStart) {
      const startNode = await WorkflowNode.findOne({ where: { workflowId: flow.id, isStart: true } });
      if (startNode) return res.status(400).json({ error: 'Ya existe un nodo inicial en este flujo.' });
    }

    const created = await WorkflowNode.create({
      workflowId: flow.id,
      name,
      departmentId,
      maxHours: maxHours || 24,
      isStart: isStart ?? false,
      isEnd: isEnd ?? false,
      requiredDocTypes: requiredDocTypes || [],
      requiredActivities: requiredActivities || [],
      typeEnvio: typeEnvio || 'PARA'
    });

    return res.status(201).json(created);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Actualizar nodo
router.put('/:workflowId/nodes/:nodeId', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const node = await WorkflowNode.findOne({
      where: { id: req.params.nodeId, workflowId: req.params.workflowId }
    });
    if (!node) return res.status(404).json({ error: 'Nodo no encontrado.' });

    // Si actualiza a isStart, validar
    if (req.body.isStart && !node.isStart) {
      const startNode = await WorkflowNode.findOne({ where: { workflowId: req.params.workflowId, isStart: true } });
      if (startNode) return res.status(400).json({ error: 'Ya existe un nodo inicial en este flujo.' });
    }

    await node.update(req.body);
    return res.json(node);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Eliminar nodo
router.delete('/:workflowId/nodes/:nodeId', requirePermission(['catalogs.manage', 'all']), async (req, res) => {
  try {
    const node = await WorkflowNode.findOne({
      where: { id: req.params.nodeId, workflowId: req.params.workflowId }
    });
    if (!node) return res.status(404).json({ error: 'Nodo no encontrado.' });

    await node.destroy();
    return res.json({ message: 'Nodo eliminado del flujo.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
