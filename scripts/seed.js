'use strict';
/* Creates the admin account + demo catalogue. Safe to run repeatedly. */
const { seed } = require('../lib/db');
seed();
console.log('Seed complete.');
