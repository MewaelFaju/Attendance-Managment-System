const { createApp } = require('./app');
const { scheduleBackups } = require('./backup');
const { lanAddresses } = require('./network');

createApp()
  .then(({ app, db, config, generatedAdminPassword }) => {
    scheduleBackups(db, config);
    if (generatedAdminPassword) {
      console.log('------------------------------------------------------------');
      console.log(' First run: created admin account');
      console.log(`   username: ${config.adminUsername}`);
      console.log(`   password: ${generatedAdminPassword}`);
      console.log(' Save this now; it is not shown again (set ADMIN_PASSWORD to choose your own).');
      console.log('------------------------------------------------------------');
    }
    app.listen(config.port, () => {
      console.log(`Attendance System running at http://localhost:${config.port}`);
      const lan = lanAddresses();
      if (lan.length) {
        console.log('Open from phones/computers on the same network:');
        for (const { address, name } of lan) console.log(`  http://${address}:${config.port}  (${name})`);
        console.log(`QR code and phone instructions: http://localhost:${config.port}/connect`);
      }
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
