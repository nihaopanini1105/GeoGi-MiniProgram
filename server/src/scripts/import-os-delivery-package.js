const fs = require('fs');
const path = require('path');
const { importDeliveryPackage } = require('../services/delivery-package-store');

async function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  if (!input) {
    console.error('Usage: node src/scripts/import-os-delivery-package.js <delivery-package.json>');
    return 2;
  }
  const filePath = path.resolve(input);
  const document = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  const result = await importDeliveryPackage(document);
  console.log(JSON.stringify({
    ok: true,
    imported: result.imported,
    idempotent: result.idempotent,
    deliveryPackageId: document.delivery_package_id,
    clientId: document.client_id,
    projectId: document.project_id
  }, null, 2));
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = { main };
