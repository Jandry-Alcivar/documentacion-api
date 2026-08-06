import { Role } from './src/models/index.js';

async function updateRoles() {
  try {
    const rolesToUpdate = ['Funcionario', 'Recepción Documental'];
    for (const roleName of rolesToUpdate) {
      const role = await Role.findOne({ where: { name: roleName } });
      if (role) {
        let perms = JSON.parse(role.permissions);
        if (!perms.includes('procedures.manage')) {
          perms.push('procedures.manage');
          await role.update({ permissions: JSON.stringify(perms) });
          console.log(`Permiso procedures.manage agregado a ${roleName}`);
        } else {
          console.log(`${roleName} ya tiene procedures.manage`);
        }
      }
    }
    console.log('Roles actualizados exitosamente.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

updateRoles();
