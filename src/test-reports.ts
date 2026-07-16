import { Document, User, Department, DocumentAlert, DocumentHistory, sequelize } from './models/index.js';

async function test() {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');

    const docCountsRaw = await Document.findAll({
      attributes: [
        'status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['status']
    });
    console.log('docCountsRaw success:', docCountsRaw.length);

    const totalUsers = await User.count();
    console.log('totalUsers:', totalUsers);

    const totalDepts = await Department.count();
    console.log('totalDepts:', totalDepts);

    const totalAlerts = await DocumentAlert.count({
      where: { isRead: false }
    });
    console.log('totalAlerts:', totalAlerts);

    const auditLogs = await DocumentHistory.findAll({
      limit: 20,
      include: [
        { association: 'user', attributes: ['name', 'email'] },
        { association: 'document', attributes: ['title'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    console.log('auditLogs success:', auditLogs.length);

  } catch (error: any) {
    console.error('CRITICAL ERROR IN ROUTE LOGIC:', error);
  } finally {
    await sequelize.close();
  }
}

test();
