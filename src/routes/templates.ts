import { Router } from 'express';
import { Template, AuditLog } from '../models/index.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.use(authenticate);

// Listar plantillas
router.get('/', async (request, response) => {
  try {
    const templates = await Template.findAll({
      include: [{ association: 'type' }],
      order: [['createdAt', 'DESC']]
    });
    
    const result = templates.map(t => ({
      ...t.toJSON(),
      createdBy: 'Administrador Sistema' // Mapeo temporal visual
    }));

    return response.json(result);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// Crear plantilla WYSIWYG
router.post('/', async (request, response) => {
  const { name, typeId, description, scope, content } = request.body as any;

  if (!name || !typeId || !content) {
    return response.status(400).json({ error: 'El nombre, tipo y contenido son requeridos.' });
  }

  try {
    const template = await Template.create({
      name, 
      typeId, 
      description: description || '', 
      scope: scope || 'GLOBAL', 
      content 
    });

    // Auditoría
    await AuditLog.create({
      userId: request.user!.id,
      module: 'Plantillas',
      action: 'CREATE_TEMPLATE',
      recordId: template.id,
      details: JSON.stringify({ name, scope })
    });

    return response.status(201).json(template);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// Editar plantilla
router.put('/:id', async (request, response) => {
  const { id } = request.params;
  const { name, typeId, description, scope, content } = request.body as any;

  try {
    const template = await Template.findByPk(id);
    if (!template) return response.status(404).json({ error: 'Plantilla no encontrada.' });

    await template.update({ name, typeId, description, scope, content });

    // Auditoría
    await AuditLog.create({
      userId: request.user!.id,
      module: 'Plantillas',
      action: 'UPDATE_TEMPLATE',
      recordId: template.id,
      details: JSON.stringify({ name, scope })
    });

    return response.json(template);
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

// Eliminar plantilla
router.delete('/:id', async (request, response) => {
  const { id } = request.params;

  try {
    const template = await Template.findByPk(id);
    if (!template) return response.status(404).json({ error: 'Plantilla no encontrada.' });

    await template.destroy();

    // Auditoría
    await AuditLog.create({
      userId: request.user!.id,
      module: 'Plantillas',
      action: 'DELETE_TEMPLATE',
      recordId: template.id,
      details: JSON.stringify({ name: template.name })
    });

    return response.json({ message: 'Plantilla eliminada correctamente.' });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
});

export default router;
